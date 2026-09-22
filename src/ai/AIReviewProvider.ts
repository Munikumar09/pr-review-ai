import * as vscode from 'vscode';
import { PullRequest } from '../models/PullRequest';
import { PullRequestComment } from '../models/PullRequestComment';
import { ReviewFinding, FindingCategory } from '../models/ReviewFinding';

export interface ReviewFile {
  path: string;
  language?: string;
  oldContent: string;
  newContent: string;
  diff: string;
  additions: number;
  deletions: number;
}

export interface RepositoryContext {
  repositoryName: string;
  projectName: string;
}

export interface ReviewContext {
  pullRequest: PullRequest;
  files: ReviewFile[];
  existingComments: PullRequestComment[];
  repositoryContext?: RepositoryContext;
}

export type ReviewMode = 'full' | 'bug' | 'security' | 'performance' | 'maintainability' | 'test';

export interface ReviewOptions {
  mode: ReviewMode;
  maxFindings: number;
  minConfidence: number;
  categories: FindingCategory[];
  /** User-configured extra instructions, appended to (never replacing) the built-in prompt. */
  customInstructions?: string;
}

export interface AIReviewResult {
  findings: ReviewFinding[];
  /** Findings the provider/parser rejected as malformed, kept for diagnostics only - never published. */
  rejectedCount: number;
  raw?: string;
}

/**
 * AI providers know nothing about Azure DevOps; they only see the
 * normalized ReviewContext (requirement #16/#2.3).
 */
export interface AIReviewProvider {
  readonly id: string;
  readonly name: string;

  isAvailable(): Promise<boolean>;

  review(
    context: ReviewContext,
    options: ReviewOptions,
    cancellationToken?: vscode.CancellationToken,
  ): Promise<AIReviewResult>;
}
