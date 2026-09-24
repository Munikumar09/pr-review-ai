import { organizationUrl } from '../utils/azureUrl';
import { MAX_FILE_BYTES } from '../utils/securityLimits';
import * as azdev from 'azure-devops-node-api';
import { IGitApi } from 'azure-devops-node-api/GitApi';
import * as GitInterfaces from 'azure-devops-node-api/interfaces/GitInterfaces';
import { PullRequest, PullRequestGroup } from '../models/PullRequest';
import { PullRequestFile } from '../models/PullRequestFile';
import { PullRequestComment, ThreadContext } from '../models/PullRequestComment';
import { AzureDevOpsMapper } from './AzureDevOpsMapper';
import { AzureDevOpsAuthProvider } from './AzureDevOpsAuth';
import { isRepositoryConfigured } from '../config/Configuration';
import { Logger } from '../utils/logger';
import {
  AzurePrReviewError,
  AuthenticationError,
  ChangedFilesError,
  ConfigurationError,
  FileContentError,
  PullRequestNotFoundError,
  RepositoryNotFoundError,
  CommentPublicationError,
} from '../utils/errors';

export interface AzureDevOpsConnectionOptions {
  organization: string;
  project: string;
  /** Repositories the extension may read from and comment on; everything else is refused. */
  repositories: string[];
}

interface RepositoryRef {
  id: string;
  name: string;
}

export interface NewThreadRequest {
  content: string;
  filePath: string;
  rightFileStartLine?: number;
  rightFileEndLine?: number;
  leftFileStartLine?: number;
  leftFileEndLine?: number;
}

/**
 * The single point of contact with the Azure DevOps REST API. Every method
 * returns normalized internal models (see AzureDevOpsMapper) - callers never
 * see raw GitInterfaces types (requirement #7).
 */
export class AzureDevOpsClient {
  private readonly logger = Logger.getInstance();
  private connection: azdev.WebApi | undefined;
  private gitApiPromise: Promise<IGitApi> | undefined;
  private userIdPromise: Promise<string | undefined> | undefined;
  /**
   * PR ids are unique across an Azure DevOps organization, so an id alone identifies its
   * repository. Filled from every PR this client maps; unknown ids are looked up once.
   */
  private readonly pullRequestRepositories = new Map<number, RepositoryRef>();

  constructor(
    private readonly auth: AzureDevOpsAuthProvider,
    private readonly getOptions: () => AzureDevOpsConnectionOptions,
  ) {}

  /** Read on every call so Configure/settings changes apply without a reload. */
  private get options(): AzureDevOpsConnectionOptions {
    return this.getOptions();
  }

  private async getConnection(): Promise<azdev.WebApi> {
    if (this.connection) {
      return this.connection;
    }
    if (!this.options.organization) {
      throw new ConfigurationError('Azure DevOps organization is not configured.');
    }
    const orgUrl = organizationUrl(this.options.organization);
    const token = await this.auth.getToken();
    if (!token) {
      throw new AuthenticationError();
    }
    const authHandler = azdev.getPersonalAccessTokenHandler(token);
    this.connection = new azdev.WebApi(orgUrl, authHandler, {
      allowRedirects: false,
      socketTimeout: 30_000,
    });
    return this.connection;
  }

  private async getGitApi(): Promise<IGitApi> {
    if (!this.gitApiPromise) {
      this.gitApiPromise = this.getConnection()
        .then((c) => c.getGitApi())
        .catch((err) => {
          this.gitApiPromise = undefined;
          throw err instanceof AzurePrReviewError ? err : new AuthenticationError(err);
        });
    }
    return this.gitApiPromise;
  }

  /** Resets cached connection state, forcing re-authentication on next call. */
  reset(): void {
    this.connection = undefined;
    this.gitApiPromise = undefined;
    this.userIdPromise = undefined;
    this.pullRequestRepositories.clear();
  }

  /** Checks the PAT can reach every configured repository. */
  async verifyConnection(): Promise<void> {
    const { repositories } = this.options;
    if (repositories.length === 0) {
      throw new ConfigurationError('No Azure DevOps repositories are configured.');
    }
    const gitApi = await this.getGitApi();
    await Promise.all(repositories.map((repository) => this.verifyRepository(gitApi, repository)));
  }

  private async verifyRepository(gitApi: IGitApi, repository: string): Promise<void> {
    try {
      const repo = await gitApi.getRepository(repository, this.options.project);
      if (!repo) {
        throw new RepositoryNotFoundError(repository);
      }
    } catch (err) {
      if (err instanceof AzurePrReviewError) {
        throw err;
      }
      // Azure DevOps/typed-rest-client attach the HTTP status to the thrown error - use it to
      // report the real cause instead of always blaming the PAT (requirement: accurate error surfacing).
      const statusCode = (err as { statusCode?: number } | undefined)?.statusCode;
      if (statusCode === 404) {
        throw new RepositoryNotFoundError(repository, err);
      }
      if (statusCode === 403) {
        throw new ConfigurationError(
          `The token does not have access to project "${this.options.project}". Check the PAT's organization/project access.`,
        );
      }
      // 401 and Azure DevOps's own 203 ("Non-Authoritative Information", returned when a PAT
      // is invalid/expired instead of a normal 401) both indicate a genuine auth failure.
      throw new AuthenticationError(err);
    }
  }

  /**
   * Lists repository names in any organization/project the PAT can read - used to pick
   * repositories while configuring, before that organization/project becomes the active one.
   */
  async listRepositories(organization: string, project: string): Promise<string[]> {
    const token = await this.auth.getToken();
    if (!token) {
      throw new AuthenticationError();
    }
    const connection = new azdev.WebApi(
      organizationUrl(organization),
      azdev.getPersonalAccessTokenHandler(token),
      { allowRedirects: false, socketTimeout: 30_000 },
    );
    try {
      const repos = await (await connection.getGitApi()).getRepositories(project);
      return repos
        .filter((repo) => repo.name && !repo.isDisabled)
        .map((repo) => repo.name!)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    } catch (err) {
      const statusCode = (err as { statusCode?: number } | undefined)?.statusCode;
      if (statusCode === 404) {
        throw new ConfigurationError(`Project "${project}" was not found in "${organization}".`);
      }
      if (statusCode === 403) {
        throw new ConfigurationError(`The token does not have access to project "${project}".`);
      }
      throw new AuthenticationError(err);
    }
  }

  async getPullRequests(repository: string, group: PullRequestGroup): Promise<PullRequest[]> {
    if (!isRepositoryConfigured(this.options.repositories, { name: repository })) {
      throw new ConfigurationError(`Repository "${repository}" is not configured.`);
    }
    const gitApi = await this.getGitApi();
    const searchCriteria: GitInterfaces.GitPullRequestSearchCriteria = {
      status: GitInterfaces.PullRequestStatus.Active,
      repositoryId: repository,
    };

    if (group === 'mine' || group === 'assignedToMe') {
      const userId = await this.getAuthenticatedUserId();
      if (userId) {
        if (group === 'mine') {
          searchCriteria.creatorId = userId;
        } else {
          searchCriteria.reviewerId = userId;
        }
      }
    }

    try {
      const prs = await gitApi.getPullRequests(repository, searchCriteria, this.options.project);
      return prs.map((pr) => this.toPullRequest(pr));
    } catch (err) {
      throw new ChangedFilesError(err);
    }
  }

  async getPullRequest(pullRequestId: number): Promise<PullRequest> {
    const gitApi = await this.getGitApi();
    let pr: GitInterfaces.GitPullRequest | undefined;
    try {
      pr = await gitApi.getPullRequestById(pullRequestId, this.options.project);
    } catch (err) {
      throw new PullRequestNotFoundError(pullRequestId, err);
    }
    if (!pr) {
      throw new PullRequestNotFoundError(pullRequestId);
    }
    const mapped = this.toPullRequest(pr);
    this.repositoryIdFor(pullRequestId); // refuses PRs from repositories that aren't configured
    return mapped;
  }

  /** Maps a PR and remembers its repository, so later PR-scoped calls go to the right one. */
  private toPullRequest(pr: GitInterfaces.GitPullRequest): PullRequest {
    const mapped = AzureDevOpsMapper.toPullRequest(pr, this.options.organization);
    if (mapped.id && mapped.repositoryId) {
      this.pullRequestRepositories.set(mapped.id, {
        id: mapped.repositoryId,
        name: mapped.repositoryName,
      });
    }
    return mapped;
  }

  /**
   * Resolves which repository a PR-scoped call must target. Re-checked on every call so a
   * repository removed from settings is refused immediately, including for already-open PRs.
   */
  private repositoryIdFor(pullRequestId: number): string {
    const repo = this.pullRequestRepositories.get(pullRequestId);
    if (!repo) {
      throw new PullRequestNotFoundError(pullRequestId);
    }
    if (!isRepositoryConfigured(this.options.repositories, repo)) {
      throw new ConfigurationError(
        `Pull request #${pullRequestId} belongs to repository "${repo.name}", which is not configured.`,
      );
    }
    return repo.id;
  }

  private async resolveRepositoryId(pullRequestId: number): Promise<string> {
    if (!this.pullRequestRepositories.has(pullRequestId)) {
      await this.getPullRequest(pullRequestId);
    }
    return this.repositoryIdFor(pullRequestId);
  }

  /** Cached per connection - it is the same for every repository and group query. */
  private getAuthenticatedUserId(): Promise<string | undefined> {
    if (!this.userIdPromise) {
      this.userIdPromise = this.getConnection()
        .then((connection) => connection.connect())
        .then((data) => data.authenticatedUser?.id)
        .catch((err) => {
          this.userIdPromise = undefined;
          this.logger.warn('Unable to resolve authenticated user for PR filtering.', err);
          return undefined;
        });
    }
    return this.userIdPromise;
  }

  /** Returns the source/target commit ids of the latest iteration, used to fetch file content at the right revisions. */
  async getLatestIterationCommits(
    pullRequestId: number,
  ): Promise<{ sourceCommitId?: string; targetCommitId?: string }> {
    const gitApi = await this.getGitApi();
    const repositoryId = await this.resolveRepositoryId(pullRequestId);
    try {
      const iterations = await gitApi.getPullRequestIterations(
        repositoryId,
        pullRequestId,
        this.options.project,
      );
      const latest = iterations[iterations.length - 1];
      return {
        sourceCommitId: latest?.sourceRefCommit?.commitId,
        targetCommitId: latest?.targetRefCommit?.commitId ?? latest?.commonRefCommit?.commitId,
      };
    } catch (err) {
      throw new ChangedFilesError(err);
    }
  }

  async getChangedFiles(pullRequestId: number): Promise<PullRequestFile[]> {
    const gitApi = await this.getGitApi();
    const repositoryId = await this.resolveRepositoryId(pullRequestId);
    try {
      const iterations = await gitApi.getPullRequestIterations(
        repositoryId,
        pullRequestId,
        this.options.project,
      );
      const latest = iterations[iterations.length - 1];
      if (!latest?.id) {
        return [];
      }
      const changes = await gitApi.getPullRequestIterationChanges(
        repositoryId,
        pullRequestId,
        latest.id,
        this.options.project,
      );
      return (changes.changeEntries ?? [])
        .filter((c) => !c.item?.isFolder)
        .map((c) => AzureDevOpsMapper.toPullRequestFile(c));
    } catch (err) {
      throw new ChangedFilesError(err);
    }
  }

  /**
   * Fetches file content at a specific commit. Azure DevOps remains the
   * source of truth even if the PR branch isn't checked out locally
   * (requirement #13).
   */
  async getFileContent(
    pullRequestId: number,
    path: string,
    commitId: string | undefined,
  ): Promise<string> {
    if (!commitId) {
      return '';
    }
    const gitApi = await this.getGitApi();
    const repositoryId = await this.resolveRepositoryId(pullRequestId);
    try {
      const versionDescriptor: GitInterfaces.GitVersionDescriptor = {
        version: commitId,
        versionType: GitInterfaces.GitVersionType.Commit,
      };
      const stream = await gitApi.getItemText(
        repositoryId,
        path,
        this.options.project,
        undefined,
        undefined,
        undefined,
        undefined,
        false,
        versionDescriptor,
      );
      return await streamToString(stream);
    } catch (err) {
      throw new FileContentError(path, err);
    }
  }

  async getPullRequestThreads(pullRequestId: number): Promise<PullRequestComment[]> {
    const gitApi = await this.getGitApi();
    const repositoryId = await this.resolveRepositoryId(pullRequestId);
    try {
      const threads = await gitApi.getThreads(repositoryId, pullRequestId, this.options.project);
      return threads
        .filter((t) => !t.isDeleted && (t.comments?.length ?? 0) > 0)
        .flatMap((t) => AzureDevOpsMapper.toPullRequestComments(t));
    } catch (err) {
      throw new ChangedFilesError(err);
    }
  }

  async createThread(
    pullRequestId: number,
    request: NewThreadRequest,
  ): Promise<PullRequestComment> {
    const gitApi = await this.getGitApi();
    const repositoryId = await this.resolveRepositoryId(pullRequestId);
    const threadContext: GitInterfaces.CommentThreadContext = {
      filePath: `/${request.filePath}`,
      rightFileStart: request.rightFileStartLine
        ? { line: request.rightFileStartLine, offset: 1 }
        : undefined,
      rightFileEnd: request.rightFileEndLine
        ? { line: request.rightFileEndLine, offset: 1 }
        : undefined,
      leftFileStart: request.leftFileStartLine
        ? { line: request.leftFileStartLine, offset: 1 }
        : undefined,
      leftFileEnd: request.leftFileEndLine
        ? { line: request.leftFileEndLine, offset: 1 }
        : undefined,
    };

    const thread: GitInterfaces.GitPullRequestCommentThread = {
      comments: [{ content: request.content, commentType: GitInterfaces.CommentType.Text }],
      status: GitInterfaces.CommentThreadStatus.Active,
      threadContext,
    };

    try {
      const created = await gitApi.createThread(
        thread,
        repositoryId,
        pullRequestId,
        this.options.project,
      );
      const comments = AzureDevOpsMapper.toPullRequestComments(created);
      if (comments.length === 0) {
        throw new CommentPublicationError();
      }
      return comments[0];
    } catch (err) {
      if (err instanceof CommentPublicationError) {
        throw err;
      }
      throw new CommentPublicationError(err);
    }
  }

  /** Adds a reply to an existing thread. */
  async updateThread(
    pullRequestId: number,
    threadId: number,
    content: string,
  ): Promise<PullRequestComment> {
    const gitApi = await this.getGitApi();
    const repositoryId = await this.resolveRepositoryId(pullRequestId);
    try {
      const comment = await gitApi.createComment(
        { content, commentType: GitInterfaces.CommentType.Text },
        repositoryId,
        pullRequestId,
        threadId,
        this.options.project,
      );
      return {
        id: comment.id ?? 0,
        threadId,
        author: comment.author?.displayName ?? 'Unknown',
        content: comment.content ?? '',
        status: 'active',
        publishedDate: comment.publishedDate ? new Date(comment.publishedDate).toISOString() : '',
      };
    } catch (err) {
      throw new CommentPublicationError(err);
    }
  }

  buildThreadContext(filePath: string, contentType: 'right' | 'left', line: number): ThreadContext {
    return contentType === 'right'
      ? { filePath, rightFileStartLine: line, rightFileEndLine: line }
      : { filePath, leftFileStartLine: line, leftFileEndLine: line };
  }
}

export async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chunks.length = 0;
      // Destroy the network stream instead of continuing to buffer hostile content.
      (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error('File download timed out.')), 30_000);
    stream.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_FILE_BYTES) {
        fail(new Error('File exceeds the 2 MiB review limit.'));
        return;
      }
      chunks.push(buffer);
    });
    stream.on('error', () => fail(new Error('File download failed.')));
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    stream.on('close', () => {
      if (!settled) fail(new Error('File download ended before completion.'));
    });
  });
}
