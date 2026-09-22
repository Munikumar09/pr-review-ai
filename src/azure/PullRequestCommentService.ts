import { AzureDevOpsClient, NewThreadRequest } from './AzureDevOpsClient';
import { PullRequestComment } from '../models/PullRequestComment';
import { StateStore } from '../storage/StateStore';

const THREADS_TTL_MS = 30_000;

export class PullRequestCommentService {
  constructor(
    private readonly client: AzureDevOpsClient,
    private readonly cache: StateStore,
  ) {}

  async getThreads(pullRequestId: number, forceRefresh = false): Promise<PullRequestComment[]> {
    const key = `pr-threads:${pullRequestId}`;
    if (!forceRefresh) {
      const cached = this.cache.getCached<PullRequestComment[]>(key);
      if (cached) {
        return cached;
      }
    }
    const threads = await this.client.getPullRequestThreads(pullRequestId);
    this.cache.setCached(key, threads, THREADS_TTL_MS);
    return threads;
  }

  async addComment(pullRequestId: number, request: NewThreadRequest): Promise<PullRequestComment> {
    const comment = await this.client.createThread(pullRequestId, request);
    this.cache.invalidate(`pr-threads:${pullRequestId}`);
    return comment;
  }

  async reply(
    pullRequestId: number,
    threadId: number,
    content: string,
  ): Promise<PullRequestComment> {
    const comment = await this.client.updateThread(pullRequestId, threadId, content);
    this.cache.invalidate(`pr-threads:${pullRequestId}`);
    return comment;
  }
}
