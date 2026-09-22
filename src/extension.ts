import * as vscode from 'vscode';
import { Configuration } from './config/Configuration';
import { PatAuthProvider } from './azure/AzureDevOpsAuth';
import { AzureDevOpsClient } from './azure/AzureDevOpsClient';
import { PullRequestService } from './azure/PullRequestService';
import { PullRequestCommentService } from './azure/PullRequestCommentService';
import { PullRequestDiffService } from './azure/PullRequestDiffService';
import { StateStore } from './storage/StateStore';
import { Logger } from './utils/logger';
import { DIFF_SCHEME, DiffContentProvider } from './diff/DiffContentProvider';
import { DiffManager } from './diff/DiffManager';
import { ReviewContextBuilder } from './ai/ReviewContextBuilder';
import { ReviewPromptBuilder } from './ai/ReviewPromptBuilder';
import { AIReviewOrchestrator } from './ai/AIReviewOrchestrator';
import { AIReviewProvider } from './ai/AIReviewProvider';
import { MockAIProvider } from './ai/providers/MockAIProvider';
import { OpenCodeProvider } from './ai/providers/OpenCodeProvider';
import { CopilotProvider } from './ai/providers/CopilotProvider';
import { ReviewState } from './review/ReviewState';
import { ReviewManager } from './review/ReviewManager';
import { FindingManager } from './review/FindingManager';
import { ApprovalManager } from './review/ApprovalManager';
import { DraftCommentManager } from './review/DraftCommentManager';
import { PullRequestTreeProvider } from './views/PullRequestTreeProvider';
import { ChangedFilesTreeProvider } from './views/ChangedFilesTreeProvider';
import { FindingsTreeProvider } from './views/FindingsTreeProvider';
import { CommentsTreeProvider } from './views/CommentsTreeProvider';
import { ReviewPanelProvider } from './webview/ReviewPanelProvider';
import { registerCommands } from './commands/registerCommands';
import { ConfigurationError } from './utils/errors';

export function activate(context: vscode.ExtensionContext): void {
  if (!vscode.workspace.isTrusted) {
    return;
  }
  const logger = Logger.getInstance();
  const config = new Configuration();
  logger.setLevel(config.getLogLevel());
  logger.info('Azure PR Review extension activating.');

  const auth = new PatAuthProvider(context.secrets);
  // Pin all UI, caches and in-flight operations to one repository until reload.
  const connection = config.getConnection();
  const connectionScope = JSON.stringify(connection);
  const client = new AzureDevOpsClient(auth, () => {
    if (JSON.stringify(config.getConnection()) !== connectionScope) {
      throw new ConfigurationError('Azure DevOps connection changed. Reload the window to apply it.');
    }
    return connection;
  });
  const cache = new StateStore(context, connectionScope);

  const prService = new PullRequestService(client, cache);
  const commentService = new PullRequestCommentService(client, cache);
  const diffService = new PullRequestDiffService(client, cache);

  const diffContentProvider = new DiffContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, diffContentProvider),
  );
  const diffManager = new DiffManager(diffService, diffContentProvider);

  const contextBuilder = new ReviewContextBuilder(diffService, commentService);
  const promptBuilder = new ReviewPromptBuilder(context.extensionPath);
  const orchestrator = new AIReviewOrchestrator(contextBuilder, diffService);

  const providers = new Map<string, AIReviewProvider>();
  const mockProvider = new MockAIProvider();
  providers.set(mockProvider.id, mockProvider);
  const opencodeProvider = new OpenCodeProvider(
    () => config.getOpenCodeCommand(),
    () => config.getOpenCodeModel(),
    promptBuilder,
    () => config.isSecretDetectionEnabled(),
  );
  providers.set(opencodeProvider.id, opencodeProvider);
  const copilotProvider = new CopilotProvider(
    () => config.getCopilotModel(), promptBuilder, () => config.isSecretDetectionEnabled(),
  );
  providers.set(copilotProvider.id, copilotProvider);

  const reviewState = new ReviewState(cache);
  const reviewManager = new ReviewManager(
    orchestrator,
    reviewState,
    config,
    providers,
  );
  const findingManager = new FindingManager(reviewState);
  const approvalManager = new ApprovalManager(reviewState, commentService, () =>
    config.isAIAttributionIncluded(),
  );
  const draftManager = new DraftCommentManager(cache);

  const prTree = new PullRequestTreeProvider(prService);
  const changedFilesTree = new ChangedFilesTreeProvider(prService, diffService);
  const findingsTree = new FindingsTreeProvider(reviewState);
  const commentsTree = new CommentsTreeProvider(commentService, draftManager);

  context.subscriptions.push(
    vscode.window.createTreeView('azurePrReview.pullRequests', { treeDataProvider: prTree }),
    vscode.window.createTreeView('azurePrReview.changedFiles', {
      treeDataProvider: changedFilesTree,
    }),
    vscode.window.createTreeView('azurePrReview.findings', { treeDataProvider: findingsTree }),
    vscode.window.createTreeView('azurePrReview.comments', { treeDataProvider: commentsTree }),
  );

  const panelProvider = new ReviewPanelProvider(
    prService,
    diffService,
    reviewManager,
    findingManager,
    approvalManager,
    reviewState,
    diffManager,
  );

  // Native VS Code Comments UI for adding line comments directly on a diff document (requirement #14/#12).
  const commentController = vscode.comments.createCommentController(
    'azurePrReview',
    'Azure PR Review',
  );
  commentController.commentingRangeProvider = {
    provideCommentingRanges: (document) => {
      if (document.uri.scheme !== DIFF_SCHEME) {
        return [];
      }
      return [new vscode.Range(0, 0, Math.max(document.lineCount - 1, 0), 0)];
    },
  };
  context.subscriptions.push(commentController);

  registerCommands(context, {
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
    aiProviders: providers,
    prTree,
    changedFilesTree,
    findingsTree,
    commentsTree,
    panelProvider,
  });

  let connectionChangeNotified = false;
  context.subscriptions.push(
    config.onDidChange(() => {
      logger.setLevel(config.getLogLevel());
      client.reset();
      prService.invalidateAll();
      if (JSON.stringify(config.getConnection()) !== connectionScope) {
        reviewManager.cancelAll();
        panelProvider.dispose();
        diffContentProvider.clear('');
        changedFilesTree.setPullRequest(undefined);
        findingsTree.setPullRequest(undefined);
        commentsTree.setPullRequest(undefined);
        if (connectionChangeNotified) return;
        connectionChangeNotified = true;
        void vscode.window.showInformationMessage(
          'Azure DevOps connection changed. Reload the window to switch repositories safely.',
          'Reload Window',
        ).then((choice) => {
          if (choice === 'Reload Window') {
            void vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        });
      }
      prTree.refresh();
    }),
    auth.onDidChangeSession(() => {
      client.reset();
      prService.invalidateAll();
      prTree.refresh();
    }),
  );

  if (!config.isConnectionConfigured()) {
    logger.info('Azure DevOps connection is not configured yet.');
    void vscode.window
      .showInformationMessage(
        'Azure PR Review: configure your Azure DevOps organization, project and repository to get started.',
        'Configure',
      )
      .then((choice) => {
        if (choice === 'Configure') {
          void vscode.commands.executeCommand('azurePrReview.configure');
        }
      });
  }

  logger.info('Azure PR Review extension activated.');
}

export function deactivate(): void {
  // Nothing to clean up explicitly - all disposables are registered on context.subscriptions.
}
