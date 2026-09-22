import * as vscode from 'vscode';
import { PullRequest } from '../models/PullRequest';
import { DraftComment } from '../models/DraftComment';
import { DraftCommentManager } from '../review/DraftCommentManager';
import { PullRequestCommentService } from '../azure/PullRequestCommentService';
import { toUserMessage } from '../utils/errors';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

/**
 * Publishes every draft comment for this PR as a real Azure DevOps thread. Confirmed first since
 * it's a real, outward-facing, hard-to-undo action. Drafts that fail to publish (network error,
 * etc.) are kept so the user can retry or edit them - everything else is cleared.
 */
export async function publishAllDraftComments(
  pullRequest: PullRequest,
  draftManager: DraftCommentManager,
  commentService: Pick<PullRequestCommentService, 'addComment'>,
): Promise<void> {
  const drafts = draftManager.list(pullRequest.id);
  if (drafts.length === 0) {
    vscode.window.showInformationMessage('No draft comments to publish.');
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `Publish ${drafts.length} draft comment(s) to PR #${pullRequest.id}? This posts them to Azure DevOps immediately.`,
    { modal: true },
    `Publish ${drafts.length} Comment(s)`,
  );
  if (choice === undefined) {
    return;
  }

  const published: DraftComment[] = [];
  const failed: Array<{ draft: DraftComment; error: string }> = [];
  for (const draft of drafts) {
    try {
      await commentService.addComment(pullRequest.id, {
        content: draft.content,
        filePath: draft.filePath,
        rightFileStartLine: draft.rightFileStartLine,
        rightFileEndLine: draft.rightFileEndLine,
        leftFileStartLine: draft.leftFileStartLine,
        leftFileEndLine: draft.leftFileEndLine,
      });
      published.push(draft);
    } catch (err) {
      logger.error(`Failed to publish draft comment on ${draft.filePath}.`, err);
      failed.push({ draft, error: toUserMessage(err) });
    }
  }

  // Keep only the ones that failed, so they can be retried or edited instead of lost.
  await draftManager.replaceAll(
    pullRequest.id,
    failed.map((f) => f.draft),
  );

  if (failed.length === 0) {
    vscode.window.showInformationMessage(`Published ${published.length} comment(s).`);
  } else {
    vscode.window.showWarningMessage(
      `Published ${published.length} comment(s). ${failed.length} failed and were kept as drafts (${failed[0].error}).`,
    );
  }
}

/** Discards every draft comment for this PR without publishing anything. */
export async function discardAllDraftComments(
  pullRequest: PullRequest,
  draftManager: DraftCommentManager,
): Promise<void> {
  const drafts = draftManager.list(pullRequest.id);
  if (drafts.length === 0) {
    vscode.window.showInformationMessage('No draft comments to discard.');
    return;
  }
  const choice = await vscode.window.showWarningMessage(
    `Discard all ${drafts.length} draft comment(s) for PR #${pullRequest.id}? This cannot be undone. Nothing has been published to Azure DevOps.`,
    { modal: true },
    'Discard All',
  );
  if (choice === 'Discard All') {
    await draftManager.clearAll(pullRequest.id);
  }
}

export async function removeDraftComment(
  pullRequest: PullRequest,
  draft: DraftComment,
  draftManager: DraftCommentManager,
): Promise<void> {
  try {
    await draftManager.remove(pullRequest.id, draft.id);
  } catch (err) {
    logger.error('Failed to remove draft comment.', err);
    vscode.window.showErrorMessage(toUserMessage(err));
  }
}

export async function editDraftComment(
  pullRequest: PullRequest,
  draft: DraftComment,
  draftManager: DraftCommentManager,
): Promise<void> {
  const content = await vscode.window.showInputBox({
    title: `Edit Draft Comment — ${draft.filePath}`,
    value: draft.content,
    validateInput: (value) => (value.trim().length === 0 ? 'Comment cannot be empty.' : undefined),
  });
  if (content === undefined) {
    return;
  }
  try {
    await draftManager.edit(pullRequest.id, draft.id, content);
  } catch (err) {
    logger.error('Failed to edit draft comment.', err);
    vscode.window.showErrorMessage(toUserMessage(err));
  }
}
