import * as vscode from 'vscode';
import { PullRequest } from '../models/PullRequest';
import { PullRequestFile } from '../models/PullRequestFile';
import { ReviewFinding } from '../models/ReviewFinding';
import { DiffManager } from '../diff/DiffManager';
import { toUserMessage } from '../utils/errors';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

/**
 * "Fix" never writes to any file. It navigates to the exact flagged lines in the diff and shows
 * the AI's suggested fix (free text, not literal code) so the person can apply it themselves.
 * The extension does not auto-apply code changes - only the human ever edits real files.
 */
export async function fixFinding(
  pullRequest: PullRequest,
  finding: ReviewFinding,
  file: PullRequestFile | undefined,
  diffManager: DiffManager,
): Promise<void> {
  if (!file) {
    vscode.window.showWarningMessage(
      `File "${finding.filePath}" was not found in this pull request.`,
    );
    return;
  }

  try {
    await diffManager.openDiff(pullRequest.id, file);
    // The diff editor becomes the active editor asynchronously after the vscode.diff command
    // resolves - a short delay lets it settle before we try to reveal a line in it (same
    // approach used by "Open Diff" elsewhere in the extension).
    setTimeout(() => {
      const newUri = vscode.window.activeTextEditor?.document.uri;
      if (newUri) {
        void diffManager.revealLine(newUri, finding.startLine);
      }
    }, 300);
  } catch (err) {
    logger.error('Failed to open diff for fix.', err);
    vscode.window.showErrorMessage(toUserMessage(err));
    return;
  }

  if (finding.suggestedFix) {
    const choice = await vscode.window.showInformationMessage(
      `Suggested fix for ${finding.filePath}:${finding.startLine} — ${finding.suggestedFix}`,
      'Copy Suggested Fix',
    );
    if (choice === 'Copy Suggested Fix') {
      await vscode.env.clipboard.writeText(finding.suggestedFix);
    }
  } else {
    vscode.window.showInformationMessage(
      'This finding has no suggested fix text - review the flagged code and decide how to address it.',
    );
  }
}
