import * as vscode from 'vscode';
import { PullRequest } from '../models/PullRequest';
import { ChangedFilesTreeProvider } from '../views/ChangedFilesTreeProvider';
import { FindingsTreeProvider } from '../views/FindingsTreeProvider';
import { CommentsTreeProvider } from '../views/CommentsTreeProvider';
import { ReviewPanelProvider } from '../webview/ReviewPanelProvider';
import { toUserMessage } from '../utils/errors';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

/**
 * Opens a pull request: makes it the "active" PR across the Changed Files,
 * Findings and Comments views, and shows the PR details/review panel
 * (requirement #10, Definition of Done steps 5-6).
 */
export async function openPullRequest(
  pullRequest: PullRequest,
  changedFiles: ChangedFilesTreeProvider,
  findings: FindingsTreeProvider,
  comments: CommentsTreeProvider,
  panelProvider: ReviewPanelProvider,
): Promise<void> {
  try {
    changedFiles.setPullRequest(pullRequest);
    findings.setPullRequest(pullRequest);
    comments.setPullRequest(pullRequest);
    await panelProvider.show(pullRequest);
  } catch (err) {
    logger.error(`Failed to open PR #${pullRequest.id}.`, err);
    vscode.window.showErrorMessage(toUserMessage(err));
  }
}

export async function openPullRequestInBrowser(pullRequest: PullRequest): Promise<void> {
  if (!pullRequest.webUrl) {
    vscode.window.showWarningMessage('This pull request has no browser URL available.');
    return;
  }
  await vscode.env.openExternal(vscode.Uri.parse(pullRequest.webUrl));
}
