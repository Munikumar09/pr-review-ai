import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { PullRequest } from '../models/PullRequest';
import { PullRequestFile } from '../models/PullRequestFile';
import { ReviewFinding } from '../models/ReviewFinding';
import { ReviewSession } from '../models/ReviewSession';
import { AIReviewProvider, ReviewContext, ReviewFile, ReviewOptions } from './AIReviewProvider';
import { ReviewContextBuilder } from './ReviewContextBuilder';
import { PullRequestDiffService } from '../azure/PullRequestDiffService';
import { mapFindingToDiffPosition, isMappingFailure } from '../utils/lineMapping';
import { throwIfCancelled } from '../utils/cancellation';
import { Logger } from '../utils/logger';

export interface ReviewBatch {
  files: ReviewFile[];
  estimatedTokens?: number;
}

const MAX_FILES_PER_BATCH = 8;
/** Very rough chars-per-token heuristic - good enough to avoid one enormous prompt (requirement #48). */
const CHARS_PER_TOKEN_ESTIMATE = 4;
const MAX_ESTIMATED_TOKENS_PER_BATCH = 6_000;

export type ReviewProgressReporter = (message: string) => void;

/** Splits a set of review files into batches, by file count and a soft token budget. */
export function createBatches(files: ReviewFile[]): ReviewBatch[] {
  const batches: ReviewBatch[] = [];
  let current: ReviewFile[] = [];
  let currentTokens = 0;

  for (const file of files) {
    const estimatedTokens = Math.ceil(
      (file.diff.length + file.newContent.length * 0.1) / CHARS_PER_TOKEN_ESTIMATE,
    );
    const wouldOverflow =
      current.length > 0 &&
      (current.length >= MAX_FILES_PER_BATCH ||
        currentTokens + estimatedTokens > MAX_ESTIMATED_TOKENS_PER_BATCH);

    if (wouldOverflow) {
      batches.push({ files: current, estimatedTokens: currentTokens });
      current = [];
      currentTokens = 0;
    }
    current.push(file);
    currentTokens += estimatedTokens;
  }

  if (current.length > 0) {
    batches.push({ files: current, estimatedTokens: currentTokens });
  }

  return batches.length > 0 ? batches : [{ files: [] }];
}

/** Merges findings that clearly describe the same issue across batches (same file, overlapping lines, similar title). */
export function dedupeFindings(findings: ReviewFinding[]): ReviewFinding[] {
  const result: ReviewFinding[] = [];
  for (const finding of findings) {
    const duplicate = result.find(
      (existing) =>
        existing.filePath === finding.filePath &&
        rangesOverlap(existing.startLine, existing.endLine, finding.startLine, finding.endLine) &&
        normalizedTitle(existing.title) === normalizedTitle(finding.title),
    );
    if (!duplicate) {
      result.push(finding);
    }
  }
  return result;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

function normalizedTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface RunReviewParams {
  pullRequest: PullRequest;
  files: PullRequestFile[];
  provider: AIReviewProvider;
  options: ReviewOptions;
  progress?: ReviewProgressReporter;
  cancellationToken?: vscode.CancellationToken;
}

/**
 * Runs the full AI review pipeline described in requirement #47, up to (but
 * not including) human approval and publishing - those stay in
 * review/ApprovalManager so this class never talks to Azure DevOps write
 * APIs.
 */
export class AIReviewOrchestrator {
  private readonly logger = Logger.getInstance();

  constructor(
    private readonly contextBuilder: ReviewContextBuilder,
    private readonly diffService: PullRequestDiffService,
  ) {}

  async run(params: RunReviewParams): Promise<ReviewSession> {
    const { pullRequest, files, provider, options, progress, cancellationToken } = params;
    const session: ReviewSession = {
      id: crypto.randomUUID(),
      pullRequestId: pullRequest.id,
      provider: provider.id,
      status: 'running',
      startedAt: new Date().toISOString(),
      findings: [],
      filesReviewed: 0,
      filesSkipped: 0,
    };

    try {
      progress?.('Building review context...');
      const context = await this.contextBuilder.build(pullRequest, files, cancellationToken);
      throwIfCancelled(cancellationToken);

      if (!(await provider.isAvailable())) {
        throw new Error(`AI provider "${provider.name}" is not available.`);
      }

      const batches = createBatches(context.files);
      const allFindings: ReviewFinding[] = [];
      let rejectedCount = 0;

      for (let i = 0; i < batches.length; i++) {
        throwIfCancelled(cancellationToken);
        const batch = batches[i];
        progress?.(`Analyzing batch ${i + 1}/${batches.length} (${batch.files.length} files)...`);

        const batchContext: ReviewContext = { ...context, files: batch.files };
        const result = await provider.review(batchContext, options, cancellationToken);
        allFindings.push(...result.findings);
        rejectedCount += result.rejectedCount;
        session.filesReviewed += batch.files.length;
      }

      progress?.('Validating findings...');
      const deduped = dedupeFindings(allFindings);
      const capped = deduped
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, options.maxFindings);

      progress?.('Mapping findings to changed lines...');
      const mapped = await this.mapFindings(pullRequest, files, capped);

      session.findings = mapped;
      session.filesSkipped = files.length - session.filesReviewed;
      session.status = 'completed';
      session.completedAt = new Date().toISOString();

      this.logger.info(
        `AI review completed for PR #${pullRequest.id}: ${mapped.length} findings kept, ${rejectedCount} rejected during parsing.`,
      );

      return session;
    } catch (err) {
      if ((err as Error)?.name === 'OperationCancelledError') {
        session.status = 'cancelled';
        session.completedAt = new Date().toISOString();
        return session;
      }
      session.status = 'failed';
      session.error = err instanceof Error ? err.message : String(err);
      session.completedAt = new Date().toISOString();
      throw err;
    }
  }

  private async mapFindings(
    pullRequest: PullRequest,
    files: PullRequestFile[],
    findings: ReviewFinding[],
  ): Promise<ReviewFinding[]> {
    const fileByPath = new Map(files.map((f) => [f.path, f]));
    const diffCache = new Map<string, Awaited<ReturnType<PullRequestDiffService['getFileDiff']>>>();

    const results: ReviewFinding[] = [];
    for (const finding of findings) {
      const file = fileByPath.get(finding.filePath);
      if (!file) {
        results.push({ ...finding, mappingError: 'File not found in this pull request.' });
        continue;
      }
      let diff = diffCache.get(finding.filePath);
      if (!diff) {
        diff = await this.diffService.getFileDiff(pullRequest.id, file);
        diffCache.set(finding.filePath, diff);
      }
      const position = mapFindingToDiffPosition(finding, diff);
      if (isMappingFailure(position)) {
        this.logger.warn(
          `Unable to map finding "${finding.title}" (${finding.filePath}:${finding.startLine}) to a changed line: ${position.reason}`,
        );
        results.push({ ...finding, mappingError: position.reason });
      } else {
        results.push({
          ...finding,
          mappingError: undefined,
          rightFileStartLine: position.rightFileStartLine,
          rightFileEndLine: position.rightFileEndLine,
          leftFileStartLine: position.leftFileStartLine,
          leftFileEndLine: position.leftFileEndLine,
        });
      }
    }
    return results;
  }
}
