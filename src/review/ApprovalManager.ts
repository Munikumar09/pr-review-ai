import { escapeMarkdown } from '../utils/markdown';
import { toUserMessage } from '../utils/errors';
import { ReviewFinding } from '../models/ReviewFinding';
import { PullRequestComment } from '../models/PullRequestComment';
import { PullRequestCommentService } from '../azure/PullRequestCommentService';
import { NewThreadRequest } from '../azure/AzureDevOpsClient';
import { ReviewState } from './ReviewState';
import { Logger } from '../utils/logger';

export interface PublishSummary {
  approved: number;
  rejected: number;
  pending: number;
  readyToPublish: number;
}

export interface PublishResult {
  published: ReviewFinding[];
  skippedDuplicates: ReviewFinding[];
  skippedUnmapped: ReviewFinding[];
  failed: Array<{ finding: ReviewFinding; error: string }>;
}

const PUBLISHABLE_STATUSES = new Set(['approved']);
const DUPLICATE_WORD_OVERLAP_THRESHOLD = 0.6;

/** Narrow view of PullRequestCommentService this class depends on - keeps unit tests free of real Azure DevOps calls. */
export type CommentServiceForApproval = Pick<
  PullRequestCommentService,
  'getThreads' | 'addComment'
>;

/**
 * The final safety gate (requirement #28). Nothing here is ever called
 * automatically by the AI pipeline - only explicit user commands
 * (`azurePrReview.approveFinding`, `azurePrReview.publishApprovedComments`)
 * reach this class.
 */
export class ApprovalManager {
  private readonly logger = Logger.getInstance();
  private readonly publishing = new Set<number>();

  constructor(
    private readonly state: ReviewState,
    private readonly commentService: CommentServiceForApproval,
    /** Read live (from "azurePrReview.ai.includeAttributionInComments") so a settings change applies without a reload. */
    private readonly getIncludeAttribution: () => boolean = () => true,
  ) {}

  getSummary(pullRequestId: number): PublishSummary {
    const session = this.state.get(pullRequestId);
    const findings = session?.findings ?? [];
    return {
      approved: findings.filter((f) => f.status === 'approved').length,
      rejected: findings.filter((f) => f.status === 'rejected').length,
      pending: findings.filter((f) => f.status === 'pending' || f.status === 'edited').length,
      readyToPublish: findings.filter((f) => PUBLISHABLE_STATUSES.has(f.status) && !f.mappingError)
        .length,
    };
  }

  /**
   * Publishes every explicitly approved finding, or - when `findingIds` is given -
   * only those specific findings (used by "Approve" to publish a single finding immediately, and
   * by "Approve All" to publish every findable one in a single call sharing the same
   * mapping/duplicate checks).
   */
  async publishApproved(
    pullRequestId: number,
    options: { findingIds?: readonly string[] } = {},
  ): Promise<PublishResult> {
    if (this.publishing.has(pullRequestId)) {
      return { published: [], skippedDuplicates: [], skippedUnmapped: [], failed: [] };
    }
    this.publishing.add(pullRequestId);
    try {
      return await this.publishOnce(pullRequestId, options);
    } finally {
      this.publishing.delete(pullRequestId);
    }
  }

  private async publishOnce(
    pullRequestId: number,
    options: { findingIds?: readonly string[] },
  ): Promise<PublishResult> {
    const session = this.state.get(pullRequestId);
    const result: PublishResult = {
      published: [],
      skippedDuplicates: [],
      skippedUnmapped: [],
      failed: [],
    };
    if (!session) {
      return result;
    }

    const targetIds = options.findingIds ? new Set(options.findingIds) : undefined;
    const existingComments = await this.commentService.getThreads(pullRequestId);
    const findings = [...session.findings];

    for (let i = 0; i < findings.length; i++) {
      const finding = findings[i];
      if (targetIds && !targetIds.has(finding.id)) {
        continue;
      }
      // Approval may have been revoked/edited while fetching comments or publishing another finding.
      const current = this.state.get(pullRequestId);
      if (
        current?.id !== session.id ||
        current.findings.find((f) => f.id === finding.id) !== finding
      )
        continue;
      if (!PUBLISHABLE_STATUSES.has(finding.status)) {
        continue;
      }

      if (finding.mappingError) {
        result.skippedUnmapped.push(finding);
        continue;
      }

      if (isDuplicateOfExisting(finding, existingComments)) {
        this.logger.info('Skipping a finding that duplicates an existing comment.');
        result.skippedDuplicates.push(finding);
        continue;
      }

      const request: NewThreadRequest = {
        content: formatFindingAsComment(finding, {
          includeAttribution: this.getIncludeAttribution(),
        }),
        filePath: finding.filePath,
        rightFileStartLine: finding.rightFileStartLine,
        rightFileEndLine: finding.rightFileEndLine,
        leftFileStartLine: finding.leftFileStartLine,
        leftFileEndLine: finding.leftFileEndLine,
      };

      try {
        await this.commentService.addComment(pullRequestId, request);
        const published: ReviewFinding = { ...finding, status: 'published' };
        result.published.push(published);
        const latest = this.state.get(pullRequestId);
        if (latest?.id === session.id) {
          await this.state.set({
            ...latest,
            findings: latest.findings.map((f) => (f === finding ? published : f)),
          });
        }
      } catch (err) {
        result.failed.push({ finding, error: toUserMessage(err) });
      }
    }

    return result;
  }
}

/**
 * Formats a finding as the text of a real Azure DevOps comment. With `includeAttribution: false`
 * (default: true), every trace that this came from an AI reviewer is stripped - no "[AI Review -
 * SEVERITY - category]" prefix, no confidence percentage, no provider name - leaving only the
 * title, description and suggested fix, indistinguishable from a comment a person typed.
 */
export function formatFindingAsComment(
  finding: ReviewFinding,
  options: { includeAttribution?: boolean } = {},
): string {
  const includeAttribution = options.includeAttribution ?? true;
  const parts = [
    includeAttribution
      ? `**[AI Review - ${finding.severity.toUpperCase()} - ${finding.category}] ${escapeMarkdown(finding.title)}**`
      : `**${escapeMarkdown(finding.title)}**`,
    '',
    escapeMarkdown(finding.description),
  ];
  if (finding.suggestedFix) {
    parts.push('', `_Suggested fix:_ ${escapeMarkdown(finding.suggestedFix)}`);
  }
  if (includeAttribution) {
    parts.push(
      '',
      `_Confidence: ${Math.round(finding.confidence * 100)}% · Provider: ${escapeMarkdown(finding.provider)}_`,
    );
  }
  return parts.join('\n');
}

/** Duplicate detection based on file, overlapping line range, and normalized content overlap (requirement #30). */
export function isDuplicateOfExisting(
  finding: ReviewFinding,
  existing: PullRequestComment[],
): boolean {
  const findingWords = wordSet(`${finding.title} ${finding.description}`);
  return existing.some((comment) => {
    if (comment.filePath !== finding.filePath) {
      return false;
    }
    if (!lineRangesNear(finding, comment)) {
      return false;
    }
    const commentWords = wordSet(comment.content);
    return overlapRatio(findingWords, commentWords) >= DUPLICATE_WORD_OVERLAP_THRESHOLD;
  });
}

function lineRangesNear(finding: ReviewFinding, comment: PullRequestComment): boolean {
  const commentLine = comment.startLine ?? comment.endLine;
  if (commentLine === undefined) {
    return false;
  }
  const tolerance = 2;
  return commentLine >= finding.startLine - tolerance && commentLine <= finding.endLine + tolerance;
}

function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4),
  );
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) {
      intersection++;
    }
  }
  return intersection / Math.min(a.size, b.size);
}
