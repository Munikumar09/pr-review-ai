import * as vscode from 'vscode';
import { Configuration } from '../config/Configuration';
import { AzureDevOpsAuthProvider } from '../azure/AzureDevOpsAuth';
import { AzureDevOpsClient } from '../azure/AzureDevOpsClient';
import { PullRequestService } from '../azure/PullRequestService';
import { PullRequestCommentService } from '../azure/PullRequestCommentService';
import { DiffManager } from '../diff/DiffManager';
import { parseDiffUri } from '../diff/DiffContentProvider';
import { ReviewManager } from '../review/ReviewManager';
import { FindingManager } from '../review/FindingManager';
import { ApprovalManager } from '../review/ApprovalManager';
import { DraftCommentManager } from '../review/DraftCommentManager';
import { PullRequestTreeProvider, PullRequestItem } from '../views/PullRequestTreeProvider';
import { ChangedFilesTreeProvider, ChangedFileItem } from '../views/ChangedFilesTreeProvider';
import { FindingsTreeProvider, FindingItem } from '../views/FindingsTreeProvider';
import { CommentsTreeProvider, DraftCommentItem } from '../views/CommentsTreeProvider';
import { ReviewPanelProvider } from '../webview/ReviewPanelProvider';
import { PullRequest } from '../models/PullRequest';
import { PullRequestFile } from '../models/PullRequestFile';
import { openPullRequest, openPullRequestInBrowser } from './openPullRequest';
import { refreshPullRequests } from './refreshPullRequests';
import { reviewPullRequest, reviewCurrentFile, cancelReview } from './reviewPullRequest';
import { addCommentFromContextMenu, handleNativeCommentReply } from './addComment';
import {
  publishAllDraftComments,
  discardAllDraftComments,
  editDraftComment,
  removeDraftComment,
} from './publishDraftComments';
import {
  approveFinding,
  removeFinding,
  editFinding,
  approveAllAndPublish,
  publishApprovedComments,
} from './publishFinding';
import { fixFinding } from './fixFinding';
import {
  selectAIProvider,
  selectAIModel,
  editCustomInstructions,
  toggleAIAttribution,
} from './configureAIReview';
import { AIReviewProvider } from '../ai/AIReviewProvider';
import { toUserMessage } from '../utils/errors';
import { Logger } from '../utils/logger';

export interface CommandServices {
  config: Configuration;
  auth: AzureDevOpsAuthProvider;
  client: AzureDevOpsClient;
  prService: PullRequestService;
  commentService: PullRequestCommentService;
  diffManager: DiffManager;
  reviewManager: ReviewManager;
  findingManager: FindingManager;
  approvalManager: ApprovalManager;
  draftManager: DraftCommentManager;
  aiProviders: Map<string, AIReviewProvider>;
  prTree: PullRequestTreeProvider;
  changedFilesTree: ChangedFilesTreeProvider;
  findingsTree: FindingsTreeProvider;
  commentsTree: CommentsTreeProvider;
  panelProvider: ReviewPanelProvider;
}

/** Registers every command listed in requirement #37 and wires it to the relevant manager/service. */
export function registerCommands(
  context: vscode.ExtensionContext,
  services: CommandServices,
): void {
  const logger = Logger.getInstance();
  const {
    config,
    auth,
    client,
    prService,
    commentService,
    diffManager,
    reviewManager,
    findingManager,
    approvalManager,
    draftManager,
    aiProviders,
    prTree,
    changedFilesTree,
    findingsTree,
    commentsTree,
    panelProvider,
  } = services;

  const register = (command: string, handler: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(command, handler));
  };

  register('azurePrReview.configure', async () => {
    const organization = await vscode.window.showInputBox({
      title: 'Azure DevOps organization',
      value: config.getConnection().organization,
      ignoreFocusOut: true,
    });
    if (organization === undefined) {
      return;
    }
    const project = await vscode.window.showInputBox({
      title: 'Azure DevOps project',
      value: config.getConnection().project,
      ignoreFocusOut: true,
    });
    if (project === undefined) {
      return;
    }
    const repository = await vscode.window.showInputBox({
      title: 'Azure DevOps repository',
      value: config.getConnection().repository,
      ignoreFocusOut: true,
    });
    if (repository === undefined) {
      return;
    }
    await config.setConnection({
      organization: organization.trim(),
      project: project.trim(),
      repository: repository.trim(),
    });
    client.reset();
    prService.invalidateAll();
    prTree.refresh();
    vscode.window.showInformationMessage('Azure DevOps connection configured.');
  });

  register('azurePrReview.signIn', async () => {
    await auth.authenticate();
    client.reset();
    prService.invalidateAll();
    prTree.refresh();

    if (!(await auth.getToken())) {
      return;
    }
    if (!config.isConnectionConfigured()) {
      vscode.window.showInformationMessage(
        'Token saved. Run "Azure PR Review: Configure Azure DevOps" to set organization, project and repository.',
      );
      return;
    }
    try {
      await client.verifyConnection();
      vscode.window.showInformationMessage('Signed in to Azure DevOps successfully.');
    } catch (err) {
      logger.error('PAT verification failed.', err);
      vscode.window.showErrorMessage(
        `${toUserMessage(err)} Check the organization/project/repository and that the PAT has Code (Read & Write) scope.`,
      );
    }
  });

  register('azurePrReview.signOut', async () => {
    await auth.logout();
    client.reset();
    prService.invalidateAll();
    prTree.refresh();
    changedFilesTree.setPullRequest(undefined);
    findingsTree.setPullRequest(undefined);
    commentsTree.setPullRequest(undefined);
  });

  register('azurePrReview.refresh', () => refreshPullRequests(prService, prTree));

  register('azurePrReview.openPullRequest', async (arg: unknown) => {
    const pullRequest = resolvePullRequest(arg);
    if (!pullRequest) {
      return;
    }
    await openPullRequest(pullRequest, changedFilesTree, findingsTree, commentsTree, panelProvider);
  });

  register('azurePrReview.openPullRequestInBrowser', async (arg: unknown) => {
    const pullRequest = resolvePullRequest(arg);
    if (pullRequest) {
      await openPullRequestInBrowser(pullRequest);
    }
  });

  register('azurePrReview.openChangedFile', async (...args: unknown[]) => {
    const pullRequest = isPullRequestLike(args[0])
      ? args[0]
      : changedFilesTree.getCurrentPullRequest();
    const filePathOrFile = args[1] as { path: string; changeType?: string } | undefined;
    const line = typeof args[2] === 'number' ? args[2] : undefined;
    if (!pullRequest || !filePathOrFile) {
      return;
    }
    try {
      const file = isFullPullRequestFile(filePathOrFile)
        ? filePathOrFile
        : (await prService.getChangedFiles(pullRequest.id)).find(
            (f) => f.path === filePathOrFile.path,
          );
      if (!file) {
        vscode.window.showWarningMessage(
          `File "${filePathOrFile.path}" was not found in this pull request.`,
        );
        return;
      }
      await diffManager.openDiff(pullRequest.id, file);
      if (typeof line === 'number') {
        // Small delay lets the diff editor become visible before we try to reveal a line in it.
        setTimeout(() => {
          const newUri = vscode.window.activeTextEditor?.document.uri;
          if (newUri) {
            void diffManager.revealLine(newUri, line);
          }
        }, 300);
      }
    } catch (err) {
      logger.error('Failed to open diff.', err);
      vscode.window.showErrorMessage(toUserMessage(err));
    }
  });

  register('azurePrReview.addComment', async (arg: unknown) => {
    if (isChangedFileItem(arg)) {
      await addCommentFromContextMenu(draftManager, arg.pullRequest, arg.node.file!);
    } else if (isCommentReply(arg)) {
      await handleNativeCommentReply(draftManager, commentService, arg);
    }
  });

  register('azurePrReview.refreshComments', () => commentsTree.refresh());

  register('azurePrReview.publishAllDraftComments', async () => {
    const pullRequest = changedFilesTree.getCurrentPullRequest();
    if (!pullRequest) {
      vscode.window.showWarningMessage('Open a pull request first.');
      return;
    }
    await publishAllDraftComments(pullRequest, draftManager, commentService);
  });

  register('azurePrReview.discardAllDraftComments', async () => {
    const pullRequest = changedFilesTree.getCurrentPullRequest();
    if (!pullRequest) {
      vscode.window.showWarningMessage('Open a pull request first.');
      return;
    }
    await discardAllDraftComments(pullRequest, draftManager);
  });

  register('azurePrReview.editDraftComment', async (arg: unknown) => {
    if (isDraftCommentItem(arg)) {
      await editDraftComment(arg.pullRequest, arg.draft, draftManager);
    }
  });

  register('azurePrReview.removeDraftComment', async (arg: unknown) => {
    if (isDraftCommentItem(arg)) {
      await removeDraftComment(arg.pullRequest, arg.draft, draftManager);
    }
  });

  register('azurePrReview.reviewPullRequest', async (arg: unknown) => {
    const pullRequest = resolvePullRequest(arg);
    if (!pullRequest) {
      return;
    }
    await reviewPullRequest(pullRequest, prService, reviewManager, findingsTree);
  });

  register('azurePrReview.reviewCurrentFile', async (arg: unknown) => {
    if (isChangedFileItem(arg)) {
      await reviewCurrentFile(arg.pullRequest, arg.node.file!, reviewManager, findingsTree);
      return;
    }
    const pullRequest = changedFilesTree.getCurrentPullRequest();
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const parsed = activeUri ? parseDiffUri(activeUri) : undefined;
    if (!pullRequest || !parsed) {
      vscode.window.showWarningMessage(
        'Open a pull request diff first, then run "AI Review Current File".',
      );
      return;
    }
    const file = (await prService.getChangedFiles(pullRequest.id)).find(
      (f) => f.path === parsed.filePath,
    );
    if (!file) {
      vscode.window.showWarningMessage(
        `File "${parsed.filePath}" was not found in this pull request.`,
      );
      return;
    }
    await reviewCurrentFile(pullRequest, file, reviewManager, findingsTree);
  });

  register('azurePrReview.cancelReview', () => {
    const pullRequest = changedFilesTree.getCurrentPullRequest();
    if (pullRequest) {
      cancelReview(pullRequest, reviewManager);
    }
  });

  register('azurePrReview.clearReview', async () => {
    const pullRequest = changedFilesTree.getCurrentPullRequest();
    if (!pullRequest) {
      vscode.window.showWarningMessage('Open a pull request first.');
      return;
    }
    const session = reviewManager.getSession(pullRequest.id);
    if (!session) {
      vscode.window.showInformationMessage(
        `No AI review results to clear for PR #${pullRequest.id}.`,
      );
      return;
    }
    if (session.status === 'running') {
      vscode.window.showWarningMessage('Cancel the running AI review before clearing it.');
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `Clear the AI review results for PR #${pullRequest.id}? This removes all findings and their approve/reject decisions. It does not affect anything already published to Azure DevOps.`,
      { modal: true },
      'Clear Review',
    );
    if (confirmed === 'Clear Review') {
      await reviewManager.clearReview(pullRequest.id);
    }
  });

  register('azurePrReview.approveFinding', async (arg: unknown) => {
    if (isFindingItem(arg)) {
      await approveFinding(arg.pullRequest, arg.finding, findingManager, approvalManager);
    }
  });

  register('azurePrReview.removeFinding', async (arg: unknown) => {
    if (isFindingItem(arg)) {
      await removeFinding(arg.pullRequest, arg.finding, findingManager);
    }
  });

  register('azurePrReview.editFinding', async (arg: unknown) => {
    if (isFindingItem(arg)) {
      await editFinding(arg.pullRequest, arg.finding, findingManager);
    }
  });

  register('azurePrReview.fixFinding', async (arg: unknown) => {
    if (isFindingItem(arg)) {
      const files = await prService.getChangedFiles(arg.pullRequest.id);
      const file = files.find((f) => f.path === arg.finding.filePath);
      await fixFinding(arg.pullRequest, arg.finding, file, diffManager);
    }
  });

  register('azurePrReview.approveAllFindings', async () => {
    const pullRequest = changedFilesTree.getCurrentPullRequest();
    if (!pullRequest) {
      vscode.window.showWarningMessage('Open a pull request first.');
      return;
    }
    const findings = reviewManager.getSession(pullRequest.id)?.findings ?? [];
    await approveAllAndPublish(pullRequest, findings, findingManager, approvalManager);
  });

  register('azurePrReview.selectAIProvider', () => selectAIProvider(config, aiProviders));

  register('azurePrReview.selectAIModel', () => selectAIModel(config, aiProviders));

  register('azurePrReview.editCustomInstructions', () => editCustomInstructions());

  register('azurePrReview.toggleAIAttribution', () => toggleAIAttribution(config));

  register('azurePrReview.publishApprovedComments', async () => {
    const pullRequest = changedFilesTree.getCurrentPullRequest();
    if (!pullRequest) {
      vscode.window.showWarningMessage('Open a pull request first.');
      return;
    }
    await publishApprovedComments(pullRequest, approvalManager);
  });
}

function resolvePullRequest(arg: unknown): PullRequest | undefined {
  if (arg instanceof PullRequestItem) {
    return arg.pullRequest;
  }
  if (isPullRequestLike(arg)) {
    return arg;
  }
  return undefined;
}

function isPullRequestLike(value: unknown): value is PullRequest {
  return typeof value === 'object' && value !== null && 'id' in value && 'sourceBranch' in value;
}

function isChangedFileItem(value: unknown): value is ChangedFileItem {
  return value instanceof ChangedFileItem;
}

function isFindingItem(value: unknown): value is FindingItem {
  return value instanceof FindingItem;
}

function isDraftCommentItem(value: unknown): value is DraftCommentItem {
  return value instanceof DraftCommentItem;
}

function isFullPullRequestFile(value: {
  path: string;
  changeType?: string;
}): value is PullRequestFile {
  return typeof (value as Partial<PullRequestFile>).additions === 'number';
}

function isCommentReply(value: unknown): value is vscode.CommentReply {
  return typeof value === 'object' && value !== null && 'text' in value && 'thread' in value;
}
