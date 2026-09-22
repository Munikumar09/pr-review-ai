import * as vscode from 'vscode';
import { PullRequest } from '../models/PullRequest';
import { ReviewFinding } from '../models/ReviewFinding';
import { FindingManager } from '../review/FindingManager';
import { ApprovalManager } from '../review/ApprovalManager';
import { toUserMessage } from '../utils/errors';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

/**
 * "Approve" marks the finding approved and immediately publishes it as a real Azure DevOps
 * comment - there is no separate publish step for a single finding. If publishing fails (network
 * error, etc.) the finding is left at "approved" so "Publish Approved Comments" can retry it.
 */
export async function approveFinding(
  pullRequest: PullRequest,
  finding: ReviewFinding,
  findingManager: FindingManager,
  approvalManager: ApprovalManager,
): Promise<void> {
  try {
    await findingManager.approve(pullRequest.id, finding.id);
    const result = await approvalManager.publishApproved(pullRequest.id, {
      findingIds: [finding.id],
    });
    if (result.published.length > 0) {
      vscode.window.showInformationMessage(`Published comment on ${finding.filePath}.`);
    } else if (result.skippedDuplicates.length > 0) {
      vscode.window.showWarningMessage('Not published: an equivalent comment already exists.');
    } else if (result.skippedUnmapped.length > 0) {
      vscode.window.showWarningMessage(
        'Not published: this finding could not be mapped to a line in the current diff.',
      );
    } else if (result.failed.length > 0) {
      vscode.window.showErrorMessage(`Failed to publish: ${result.failed[0].error}`);
    }
  } catch (err) {
    logger.error('Failed to approve finding.', err);
    vscode.window.showErrorMessage(toUserMessage(err));
  }
}

/** "Remove" permanently deletes the finding from this review session - it does not touch Azure DevOps. */
export async function removeFinding(
  pullRequest: PullRequest,
  finding: ReviewFinding,
  findingManager: FindingManager,
): Promise<void> {
  try {
    await findingManager.remove(pullRequest.id, finding.id);
  } catch (err) {
    logger.error('Failed to remove finding.', err);
    vscode.window.showErrorMessage(toUserMessage(err));
  }
}

export async function editFinding(
  pullRequest: PullRequest,
  finding: ReviewFinding,
  findingManager: FindingManager,
): Promise<void> {
  const title = await vscode.window.showInputBox({ title: 'Finding title', value: finding.title });
  if (title === undefined) {
    return;
  }
  const description = await vscode.window.showInputBox({
    title: 'Finding description',
    value: finding.description,
  });
  if (description === undefined) {
    return;
  }
  const suggestedFix = await vscode.window.showInputBox({
    title: 'Suggested fix (optional)',
    value: finding.suggestedFix ?? '',
  });

  try {
    await findingManager.edit(pullRequest.id, finding.id, {
      title,
      description,
      suggestedFix: suggestedFix || undefined,
    });
  } catch (err) {
    logger.error('Failed to edit finding.', err);
    vscode.window.showErrorMessage(toUserMessage(err));
  }
}

/**
 * "Approve All" - approves every pending/edited finding, then publishes everything publishable
 * (including anything already approved earlier) in one batch. Confirmed first since it can post
 * several real comments to Azure DevOps at once.
 */
export async function approveAllAndPublish(
  pullRequest: PullRequest,
  findings: ReviewFinding[],
  findingManager: FindingManager,
  approvalManager: ApprovalManager,
): Promise<void> {
  const toApprove = findings.filter((f) => f.status === 'pending' || f.status === 'edited');
  const alreadyApproved = findings.filter((f) => f.status === 'approved');
  const total = toApprove.length + alreadyApproved.length;
  if (total === 0) {
    vscode.window.showInformationMessage('No findings to approve.');
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `Approve and publish ${total} finding(s) as comments on PR #${pullRequest.id}? This posts real comments to Azure DevOps.`,
    { modal: true },
    `Approve All (${total})`,
  );
  if (choice === undefined) {
    return;
  }

  try {
    for (const finding of toApprove) {
      await findingManager.approve(pullRequest.id, finding.id);
    }
    const result = await approvalManager.publishApproved(pullRequest.id);
    vscode.window.showInformationMessage(
      `Published ${result.published.length} comment(s). Skipped ${result.skippedDuplicates.length} duplicate(s), ${result.skippedUnmapped.length} unmapped, ${result.failed.length} failed.`,
    );
  } catch (err) {
    logger.error('Failed to approve all findings.', err);
    vscode.window.showErrorMessage(toUserMessage(err));
  }
}

/**
 * Manual retry/catch-up: publishes any finding still sitting at "approved"/"edited" that hasn't
 * been published yet (e.g. because its automatic publish on Approve failed).
 */
export async function publishApprovedComments(
  pullRequest: PullRequest,
  approvalManager: ApprovalManager,
): Promise<void> {
  const summary = approvalManager.getSummary(pullRequest.id);
  if (summary.readyToPublish === 0) {
    vscode.window.showInformationMessage('No approved findings are ready to publish.');
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    `Approved: ${summary.approved}  Rejected: ${summary.rejected}  Pending: ${summary.pending}  Ready to publish: ${summary.readyToPublish}`,
    { modal: true },
    `Publish ${summary.readyToPublish} Comments`,
  );
  if (!choice) {
    return;
  }

  try {
    const result = await approvalManager.publishApproved(pullRequest.id);
    vscode.window.showInformationMessage(
      `Published ${result.published.length} comment(s). Skipped ${result.skippedDuplicates.length} duplicate(s), ${result.skippedUnmapped.length} unmapped, ${result.failed.length} failed.`,
    );
  } catch (err) {
    logger.error('Failed to publish approved findings.', err);
    vscode.window.showErrorMessage(toUserMessage(err));
  }
}
