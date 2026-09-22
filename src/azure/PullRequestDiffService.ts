import { createTwoFilesPatch } from 'diff';
import { AzureDevOpsClient } from './AzureDevOpsClient';
import { PullRequestFile } from '../models/PullRequestFile';
import { FileDiff } from '../models/FileDiff';
import { StateStore } from '../storage/StateStore';

const FILE_CONTENT_TTL_MS = 5 * 60_000;

/**
 * Retrieves old/new file content and computes diffs. Azure DevOps remains
 * the source of truth even when the PR branch isn't checked out locally
 * (requirement #13) - this service always fetches content from the API,
 * never from the local workspace.
 */
export class PullRequestDiffService {
  constructor(
    private readonly client: AzureDevOpsClient,
    private readonly cache: StateStore,
  ) {}

  async getFileDiff(pullRequestId: number, file: PullRequestFile): Promise<FileDiff> {
    const { sourceCommitId, targetCommitId } = await this.getCommits(pullRequestId);

    const oldContent =
      file.changeType === 'add'
        ? ''
        : await this.getContentCached(file.originalPath ?? file.path, targetCommitId);
    const newContent =
      file.changeType === 'delete' ? '' : await this.getContentCached(file.path, sourceCommitId);

    const patch =
      oldContent !== newContent
        ? createTwoFilesPatch(
            file.originalPath ?? file.path,
            file.path,
            oldContent,
            newContent,
            '',
            '',
            {
              context: 3,
            },
          )
        : '';

    const { additions, deletions } = countChanges(patch);

    return {
      path: file.path,
      originalPath: file.originalPath,
      oldContent,
      newContent,
      patch,
      additions,
      deletions,
    };
  }

  private async getCommits(
    pullRequestId: number,
  ): Promise<{ sourceCommitId?: string; targetCommitId?: string }> {
    const key = `pr-commits:${pullRequestId}`;
    const cached = this.cache.getCached<{ sourceCommitId?: string; targetCommitId?: string }>(key);
    if (cached) {
      return cached;
    }
    const commits = await this.client.getLatestIterationCommits(pullRequestId);
    this.cache.setCached(key, commits, FILE_CONTENT_TTL_MS);
    return commits;
  }

  private async getContentCached(path: string, commitId: string | undefined): Promise<string> {
    const key = `file-content:${commitId}:${path}`;
    const cached = this.cache.getCached<string>(key);
    if (cached !== undefined) {
      return cached;
    }
    const content = await this.client.getFileContent(path, commitId);
    this.cache.setCached(key, content, FILE_CONTENT_TTL_MS);
    return content;
  }
}

function countChanges(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    if (line.startsWith('+')) {
      additions++;
    } else if (line.startsWith('-')) {
      deletions++;
    }
  }
  return { additions, deletions };
}
