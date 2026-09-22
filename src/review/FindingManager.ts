import { ReviewFinding, FindingCategory, FindingSeverity } from '../models/ReviewFinding';
import { ReviewState } from './ReviewState';
import { AzurePrReviewError } from '../utils/errors';

export interface FindingEdit {
  title?: string;
  description?: string;
  suggestedFix?: string;
  severity?: FindingSeverity;
  category?: FindingCategory;
  startLine?: number;
  endLine?: number;
}

export class FindingNotFoundError extends AzurePrReviewError {
  constructor(id: string) {
    super(
      `Finding not found: ${id}`,
      'That finding could not be found in the current review session.',
    );
  }
}

/**
 * Applies approve/reject/edit transitions to findings within a review
 * session (requirement #27). Only `approve` marks a finding eligible for
 * publication; `reject` is terminal and guarantees the finding is never
 * sent to Azure DevOps (see ApprovalManager).
 */
export class FindingManager {
  constructor(private readonly state: ReviewState) {}

  async approve(pullRequestId: number, findingId: string): Promise<ReviewFinding> {
    return this.updateFinding(pullRequestId, findingId, (finding) => ({
      ...finding,
      status: finding.status === 'published' ? 'published' : 'approved',
    }));
  }

  async reject(pullRequestId: number, findingId: string): Promise<ReviewFinding> {
    return this.updateFinding(pullRequestId, findingId, (finding) => ({
      ...finding,
      status: 'rejected',
    }));
  }

  async edit(pullRequestId: number, findingId: string, edit: FindingEdit): Promise<ReviewFinding> {
    return this.updateFinding(pullRequestId, findingId, (finding) => ({
      ...finding,
      ...edit,
      status: 'edited',
      ...((edit.startLine !== undefined && edit.startLine !== finding.startLine) ||
      (edit.endLine !== undefined && edit.endLine !== finding.endLine)
        ? {
            rightFileStartLine: undefined,
            rightFileEndLine: undefined,
            leftFileStartLine: undefined,
            leftFileEndLine: undefined,
            mappingError:
              'The line range changed. Run a new review before publishing this finding.',
          }
        : {}),
    }));
  }

  /** Permanently removes a finding from the review session. Unlike reject, it never appears in the list again. */
  async remove(pullRequestId: number, findingId: string): Promise<void> {
    const session = this.state.get(pullRequestId);
    if (!session) {
      throw new FindingNotFoundError(findingId);
    }
    const findings = session.findings.filter((f) => f.id !== findingId);
    if (findings.length === session.findings.length) {
      throw new FindingNotFoundError(findingId);
    }
    await this.state.set({ ...session, findings });
  }

  private async updateFinding(
    pullRequestId: number,
    findingId: string,
    updater: (finding: ReviewFinding) => ReviewFinding,
  ): Promise<ReviewFinding> {
    const session = this.state.get(pullRequestId);
    if (!session) {
      throw new FindingNotFoundError(findingId);
    }
    const index = session.findings.findIndex((f) => f.id === findingId);
    if (index === -1) {
      throw new FindingNotFoundError(findingId);
    }
    const updated = updater(session.findings[index]);
    const findings = [...session.findings];
    findings[index] = updated;
    await this.state.set({ ...session, findings });
    return updated;
  }
}
