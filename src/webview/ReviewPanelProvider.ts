import { openAzureUrl } from '../utils/azureUrl';
import * as vscode from 'vscode';
import { PRReviewPanel, PanelMessage } from './PRReviewPanel';
import { PullRequestService } from '../azure/PullRequestService';
import { PullRequestDiffService } from '../azure/PullRequestDiffService';
import { attachDiffStats } from '../azure/attachDiffStats';
import { ReviewManager } from '../review/ReviewManager';
import { FindingManager } from '../review/FindingManager';
import { ApprovalManager } from '../review/ApprovalManager';
import { ReviewState } from '../review/ReviewState';
import { DiffManager } from '../diff/DiffManager';
import { PullRequest } from '../models/PullRequest';
import { PullRequestFile } from '../models/PullRequestFile';
import { ReviewFinding } from '../models/ReviewFinding';
import { approveFinding, removeFinding, approveAllAndPublish } from '../commands/publishFinding';
import { fixFinding } from '../commands/fixFinding';
import { toUserMessage } from '../utils/errors';
import { Logger } from '../utils/logger';

/**
 * Owns the (at most one, per PR) open PRReviewPanel and bridges its UI
 * events to the application-logic managers. No Azure DevOps/AI calls
 * happen inside PRReviewPanel itself.
 */
export class ReviewPanelProvider {
  private readonly logger = Logger.getInstance();
  private readonly panels = new Map<number, PRReviewPanel>();
  /** Changed files with diff stats already computed, so approve/reject/edit don't re-fetch and re-diff every file over the network on every click. */
  private readonly filesCache = new Map<number, PullRequestFile[]>();

  constructor(
    private readonly prService: PullRequestService,
    private readonly diffService: PullRequestDiffService,
    private readonly reviewManager: ReviewManager,
    private readonly findingManager: FindingManager,
    private readonly approvalManager: ApprovalManager,
    private readonly reviewState: ReviewState,
    private readonly diffManager: DiffManager,
  ) {
    this.reviewState.onDidChange((pullRequestId) => {
      const panel = this.panels.get(pullRequestId);
      if (panel) {
        void this.refresh(pullRequestId);
      }
    });
  }

  dispose(): void {
    for (const panel of this.panels.values()) {
      panel.dispose();
    }
    this.panels.clear();
    this.filesCache.clear();
  }

  async show(pullRequest: PullRequest): Promise<void> {
    let panel = this.panels.get(pullRequest.id);
    if (!panel) {
      panel = new PRReviewPanel(pullRequest);
      this.panels.set(pullRequest.id, panel);
      panel.onDidReceiveMessage((message) => this.handleMessage(pullRequest, message));
      panel.onDidDispose(() => {
        this.panels.delete(pullRequest.id);
        this.filesCache.delete(pullRequest.id);
      });
    } else {
      panel.reveal();
    }
    await this.refresh(pullRequest.id, { reloadFiles: true });
  }

  /**
   * `reloadFiles` re-fetches the changed-files list and recomputes every file's diff stats over
   * the network - only worth doing when the file list itself might have changed (opening the
   * panel, or an explicit Refresh). Approve/reject/edit/publish only change finding state, which
   * is already in memory (ReviewState) - redoing the network diff work for those made every
   * click slow and, on any transient network error, could throw before panel.update() ran, so
   * the state change (already saved) would never make it to the screen.
   */
  private async refresh(
    pullRequestId: number,
    options: { reloadFiles?: boolean } = {},
  ): Promise<void> {
    const panel = this.panels.get(pullRequestId);
    if (!panel) {
      return;
    }
    try {
      const pullRequest = await this.prService.getPullRequest(pullRequestId);
      let files = this.filesCache.get(pullRequestId);
      if (options.reloadFiles || !files) {
        files = await this.prService.getChangedFiles(pullRequestId);
        // Azure DevOps's changes API never reports line counts (see attachDiffStats) - without
        // this the panel's Additions/Deletions totals always render as +0/-0.
        await attachDiffStats(this.diffService, pullRequestId, files);
        this.filesCache.set(pullRequestId, files);
      }
      const session = this.reviewState.get(pullRequestId);
      const summary = session ? this.approvalManager.getSummary(pullRequestId) : undefined;
      panel.update({ pullRequest, files, session, summary });
    } catch (err) {
      this.logger.error(`Failed to refresh review panel for PR #${pullRequestId}.`, err);
      vscode.window.showErrorMessage(toUserMessage(err));
    }
  }

  private async handleMessage(pullRequest: PullRequest, message: PanelMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'refresh':
          this.prService.invalidatePullRequest(pullRequest.id);
          this.filesCache.delete(pullRequest.id);
          await this.refresh(pullRequest.id, { reloadFiles: true });
          break;
        case 'openInBrowser':
          await openAzureUrl(pullRequest.webUrl);
          break;
        case 'reviewPullRequest':
          await vscode.commands.executeCommand('azurePrReview.reviewPullRequest', pullRequest);
          break;
        case 'cancelReview':
          this.reviewManager.cancelReview(pullRequest.id);
          break;
        case 'clearReview': {
          const confirmed = await vscode.window.showWarningMessage(
            `Clear the AI review results for PR #${pullRequest.id}? This removes all findings and their approve/reject decisions. It does not affect anything already published to Azure DevOps.`,
            { modal: true },
            'Clear Review',
          );
          if (confirmed === 'Clear Review') {
            await this.reviewManager.clearReview(pullRequest.id);
          }
          break;
        }
        case 'approve': {
          const finding = this.findFinding(pullRequest.id, message.findingId);
          if (finding) {
            await approveFinding(pullRequest, finding, this.findingManager, this.approvalManager);
          }
          break;
        }
        case 'remove': {
          const finding = this.findFinding(pullRequest.id, message.findingId);
          if (finding) {
            await removeFinding(pullRequest, finding, this.findingManager);
          }
          break;
        }
        case 'editFinding':
          await this.editFinding(pullRequest, message.findingId);
          break;
        case 'openFinding':
          await this.openFinding(pullRequest, message.findingId);
          break;
        case 'fix': {
          const finding = this.findFinding(pullRequest.id, message.findingId);
          if (finding) {
            const files = await this.prService.getChangedFiles(pullRequest.id);
            const file = files.find((f) => f.path === finding.filePath);
            await fixFinding(pullRequest, finding, file, this.diffManager);
          }
          break;
        }
        case 'approveAll': {
          const findings = this.reviewState.get(pullRequest.id)?.findings ?? [];
          await approveAllAndPublish(
            pullRequest,
            findings,
            this.findingManager,
            this.approvalManager,
          );
          break;
        }
        case 'publishApproved': {
          const result = await this.approvalManager.publishApproved(pullRequest.id);
          vscode.window.showInformationMessage(
            `Published ${result.published.length} comment(s). Skipped ${result.skippedDuplicates.length} duplicate(s), ${result.skippedUnmapped.length} unmapped, ${result.failed.length} failed.`,
          );
          await this.refresh(pullRequest.id);
          break;
        }
      }
    } catch (err) {
      this.logger.error(`Failed to handle review panel action "${message.type}".`, err);
      vscode.window.showErrorMessage(toUserMessage(err));
    }
  }

  private findFinding(pullRequestId: number, findingId: string): ReviewFinding | undefined {
    return this.reviewState.get(pullRequestId)?.findings.find((f) => f.id === findingId);
  }

  private async openFinding(pullRequest: PullRequest, findingId: string): Promise<void> {
    const finding = this.findFinding(pullRequest.id, findingId);
    if (!finding) {
      return;
    }
    const files = await this.prService.getChangedFiles(pullRequest.id);
    const file = files.find((f) => f.path === finding.filePath);
    if (!file) {
      vscode.window.showWarningMessage(
        `File "${finding.filePath}" was not found in this pull request.`,
      );
      return;
    }
    await this.diffManager.openDiff(pullRequest.id, file);
  }

  private async editFinding(pullRequest: PullRequest, findingId: string): Promise<void> {
    const finding = this.findFinding(pullRequest.id, findingId);
    if (!finding) {
      return;
    }
    const title = await vscode.window.showInputBox({
      title: 'Finding title',
      value: finding.title,
    });
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
    await this.findingManager.edit(pullRequest.id, findingId, {
      title,
      description,
      suggestedFix: suggestedFix || undefined,
    });
  }
}
