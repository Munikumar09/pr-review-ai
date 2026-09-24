import { AzureDevOpsClient } from './AzureDevOpsClient';
import { PullRequest, PullRequestGroup } from '../models/PullRequest';
import { PullRequestFile } from '../models/PullRequestFile';
import { StateStore } from '../storage/StateStore';

const PR_LIST_TTL_MS = 60_000;
const PR_DETAIL_TTL_MS = 60_000;
const CHANGED_FILES_TTL_MS = 120_000;

/** Application-facing façade over AzureDevOpsClient for PR listing/metadata, with caching (#35). */
export class PullRequestService {
  constructor(
    private readonly client: AzureDevOpsClient,
    private readonly cache: StateStore,
  ) {}

  async listPullRequests(
    repository: string,
    group: PullRequestGroup,
    forceRefresh = false,
  ): Promise<PullRequest[]> {
    const key = `pr-list:${repository.toLowerCase()}:${group}`;
    if (!forceRefresh) {
      const cached = this.cache.getCached<PullRequest[]>(key);
      if (cached) {
        return cached;
      }
    }
    const prs = await this.client.getPullRequests(repository, group);
    this.cache.setCached(key, prs, PR_LIST_TTL_MS);
    return prs;
  }

  async getPullRequest(id: number, forceRefresh = false): Promise<PullRequest> {
    const key = `pr-detail:${id}`;
    if (!forceRefresh) {
      const cached = this.cache.getCached<PullRequest>(key);
      if (cached) {
        return cached;
      }
    }
    const pr = await this.client.getPullRequest(id);
    this.cache.setCached(key, pr, PR_DETAIL_TTL_MS);
    return pr;
  }

  async getChangedFiles(pullRequestId: number, forceRefresh = false): Promise<PullRequestFile[]> {
    const key = `pr-files:${pullRequestId}`;
    if (!forceRefresh) {
      const cached = this.cache.getCached<PullRequestFile[]>(key);
      if (cached) {
        return cached;
      }
    }
    const files = await this.client.getChangedFiles(pullRequestId);
    this.cache.setCached(key, files, CHANGED_FILES_TTL_MS);
    return files;
  }

  invalidatePullRequest(pullRequestId: number): void {
    this.cache.invalidate(`pr-detail:${pullRequestId}`);
    this.cache.invalidate(`pr-files:${pullRequestId}`);
  }

  invalidateAll(): void {
    this.cache.invalidateAll();
  }
}
