import * as vscode from 'vscode';
import { PullRequest } from '../models/PullRequest';
import { PullRequestFile } from '../models/PullRequestFile';
import { ReviewSession } from '../models/ReviewSession';
import { AIReviewProvider, ReviewMode, ReviewOptions } from '../ai/AIReviewProvider';
import { AIReviewOrchestrator } from '../ai/AIReviewOrchestrator';
import { PullRequestDiffService } from '../azure/PullRequestDiffService';
import { ReviewState } from './ReviewState';
import { Configuration } from '../config/Configuration';
import { detectSecrets } from '../utils/secretDetection';
import { Logger } from '../utils/logger';

export const LARGE_PR_FILE_THRESHOLD = 100;
export const LARGE_PR_LINE_THRESHOLD = 10_000;

export interface StartReviewParams {
  pullRequest: PullRequest;
  files: PullRequestFile[];
  mode: ReviewMode;
}

/**
 * Application-layer entry point AI review commands go through. Owns
 * provider selection, cancellation, and the secret-detection safety prompt;
 * delegates the actual pipeline to AIReviewOrchestrator.
 */
export class ReviewManager {
  private readonly logger = Logger.getInstance();
  private readonly cancellationSources = new Map<number, vscode.CancellationTokenSource>();

  constructor(
    private readonly orchestrator: AIReviewOrchestrator,
    private readonly diffService: PullRequestDiffService,
    private readonly state: ReviewState,
    private readonly config: Configuration,
    private readonly providers: Map<string, AIReviewProvider>,
  ) {}

  getProvider(id: string): AIReviewProvider | undefined {
    return this.providers.get(id);
  }

  listProviders(): AIReviewProvider[] {
    return Array.from(this.providers.values());
  }

  /** Returns true if the PR is large enough that the caller should prompt the user to narrow scope (requirement #46). */
  isLargePullRequest(files: PullRequestFile[]): boolean {
    if (files.length > LARGE_PR_FILE_THRESHOLD) {
      return true;
    }
    const totalChanges = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
    return totalChanges > LARGE_PR_LINE_THRESHOLD;
  }

  /**
   * Checks the selected files' diffs for likely secrets before they'd be
   * sent to an AI provider (requirement #41). Returns the list of matches
   * found so the caller can show a confirmation prompt; an empty array
   * means it's safe to proceed silently.
   */
  async checkForSecrets(pullRequest: PullRequest, files: PullRequestFile[]): Promise<string[]> {
    if (!this.config.isSecretDetectionEnabled()) {
      return [];
    }
    const kinds = new Set<string>();
    for (const file of files) {
      const diff = await this.diffService.getFileDiff(pullRequest.id, file);
      for (const match of detectSecrets(diff.newContent)) {
        kinds.add(match.kind);
      }
    }
    return Array.from(kinds);
  }

  async startReview(
    params: StartReviewParams,
    progress?: (message: string) => void,
  ): Promise<ReviewSession> {
    const provider = this.providers.get(this.config.getAIProvider());
    if (!provider) {
      throw new Error(`Unknown AI provider "${this.config.getAIProvider()}".`);
    }

    const options: ReviewOptions = {
      mode: params.mode,
      maxFindings: this.config.getAIMaxFindings(),
      minConfidence: this.config.getAIMinConfidence(),
      categories: this.config.getAIReviewCategories(),
      customInstructions: this.config.getAICustomInstructions(),
    };

    this.cancelReview(params.pullRequest.id);
    const cts = new vscode.CancellationTokenSource();
    this.cancellationSources.set(params.pullRequest.id, cts);

    try {
      const session = await this.orchestrator.run({
        pullRequest: params.pullRequest,
        files: params.files,
        provider,
        options,
        progress,
        cancellationToken: cts.token,
      });
      await this.state.set(session);
      return session;
    } finally {
      this.cancellationSources.delete(params.pullRequest.id);
      cts.dispose();
    }
  }

  cancelReview(pullRequestId: number): void {
    const cts = this.cancellationSources.get(pullRequestId);
    if (cts) {
      this.logger.info(`Cancelling AI review for PR #${pullRequestId}.`);
      cts.cancel();
    }
  }

  getSession(pullRequestId: number): ReviewSession | undefined {
    return this.state.get(pullRequestId);
  }

  /** Discards the AI review session (findings and their approve/reject decisions) for a PR. Never touches anything already published to Azure DevOps. */
  async clearReview(pullRequestId: number): Promise<void> {
    await this.state.clear(pullRequestId);
  }
}
