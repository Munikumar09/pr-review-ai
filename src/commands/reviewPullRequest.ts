import * as vscode from 'vscode';
import { PullRequest } from '../models/PullRequest';
import { PullRequestFile } from '../models/PullRequestFile';
import { PullRequestService } from '../azure/PullRequestService';
import { ReviewManager } from '../review/ReviewManager';
import { ReviewMode } from '../ai/AIReviewProvider';
import { FindingsTreeProvider } from '../views/FindingsTreeProvider';
import { toUserMessage } from '../utils/errors';
import { OperationCancelledError } from '../utils/cancellation';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

const MODE_ITEMS: Array<{ label: string; mode: ReviewMode; description: string }> = [
  { label: 'Full Review', mode: 'full', description: 'All requested categories' },
  { label: 'Bug Review', mode: 'bug', description: 'Correctness issues only' },
  { label: 'Security Review', mode: 'security', description: 'Security-focused' },
  { label: 'Performance Review', mode: 'performance', description: 'Performance-focused' },
  {
    label: 'Maintainability Review',
    mode: 'maintainability',
    description: 'Readability & complexity',
  },
  { label: 'Test Review', mode: 'test', description: 'Missing/inadequate test coverage' },
];

/** Runs a full AI review of a pull request, with large-PR scope selection and a secret-detection safety gate (requirements #21/#25/#41/#46). */
export async function reviewPullRequest(
  pullRequest: PullRequest,
  prService: PullRequestService,
  reviewManager: ReviewManager,
  findingsTree: FindingsTreeProvider,
): Promise<void> {
  try {
    // Usually cached, but a cold fetch hits Azure DevOps before any UI appears - show it's working.
    const allFiles = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Loading changed files…' },
      () => prService.getChangedFiles(pullRequest.id),
    );
    if (allFiles.length === 0) {
      vscode.window.showInformationMessage('This pull request has no changed files to review.');
      return;
    }

    const files = await selectReviewScope(allFiles, reviewManager);
    if (!files) {
      return; // user cancelled scope selection
    }

    const mode = await pickReviewMode();
    if (!mode) {
      return;
    }

    await runReviewWithProgress(pullRequest, files, mode, reviewManager, findingsTree);
  } catch (err) {
    logger.error(`AI review failed for PR #${pullRequest.id}.`, err);
    vscode.window.showErrorMessage(toUserMessage(err));
  }
}

/** Context-menu entry point to review a single changed file (requirement #38). */
export async function reviewCurrentFile(
  pullRequest: PullRequest,
  file: PullRequestFile,
  reviewManager: ReviewManager,
  findingsTree: FindingsTreeProvider,
): Promise<void> {
  try {
    const mode = await pickReviewMode();
    if (!mode) {
      return;
    }
    await runReviewWithProgress(pullRequest, [file], mode, reviewManager, findingsTree);
  } catch (err) {
    logger.error(`AI review failed for PR #${pullRequest.id} file ${file.path}.`, err);
    vscode.window.showErrorMessage(toUserMessage(err));
  }
}

export function cancelReview(pullRequest: PullRequest, reviewManager: ReviewManager): void {
  reviewManager.cancelReview(pullRequest.id);
}

async function selectReviewScope(
  allFiles: PullRequestFile[],
  reviewManager: ReviewManager,
): Promise<PullRequestFile[] | undefined> {
  if (!reviewManager.isLargePullRequest(allFiles)) {
    return allFiles;
  }

  const choice = await vscode.window.showQuickPick(
    [
      { label: 'Review selected files (recommended)', value: 'select' as const },
      { label: `Review entire PR (${allFiles.length} files)`, value: 'all' as const },
    ],
    {
      title: `Large PR detected (${allFiles.length} files). Choose review scope.`,
      ignoreFocusOut: true,
    },
  );
  if (!choice) {
    return undefined;
  }
  if (choice.value === 'all') {
    return allFiles;
  }

  const picked = await vscode.window.showQuickPick(
    allFiles.map((f) => ({ label: f.path, description: f.changeType, file: f, picked: false })),
    { canPickMany: true, title: 'Select files to review', ignoreFocusOut: true },
  );
  if (!picked || picked.length === 0) {
    return undefined;
  }
  return picked.map((p) => p.file);
}

async function pickReviewMode(): Promise<ReviewMode | undefined> {
  const picked = await vscode.window.showQuickPick(
    MODE_ITEMS.map((item) => ({
      label: item.label,
      description: item.description,
      mode: item.mode,
    })),
    { title: 'Select review mode', ignoreFocusOut: true },
  );
  return picked?.mode;
}

async function runReviewWithProgress(
  pullRequest: PullRequest,
  files: PullRequestFile[],
  mode: ReviewMode,
  reviewManager: ReviewManager,
  findingsTree: FindingsTreeProvider,
): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Reviewing PR #${pullRequest.id}...`,
      cancellable: true,
    },
    async (progress, token) => {
      token.onCancellationRequested(() => reviewManager.cancelReview(pullRequest.id));
      try {
        const session = await reviewManager.startReview({ pullRequest, files, mode }, (message) =>
          progress.report({ message }),
        );
        findingsTree.refresh();

        if (session.status === 'cancelled') {
          vscode.window.showInformationMessage('AI review cancelled.');
          return;
        }
        if (session.status === 'failed') {
          vscode.window.showErrorMessage(`AI review failed: ${session.error}`);
          return;
        }

        const counts = countBySeverity(session.findings.map((f) => f.severity));
        vscode.window.showInformationMessage(
          `AI review complete: ${session.findings.length} findings (Critical ${counts.critical}, High ${counts.high}, Medium ${counts.medium}, Low ${counts.low}). Files reviewed: ${session.filesReviewed}, skipped: ${session.filesSkipped}.`,
        );
      } catch (err) {
        if (err instanceof OperationCancelledError) {
          vscode.window.showInformationMessage('AI review cancelled.');
          return;
        }
        throw err;
      }
    },
  );
}

function countBySeverity(severities: string[]): Record<string, number> {
  const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const s of severities) {
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return counts;
}
