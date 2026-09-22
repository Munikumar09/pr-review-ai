import * as vscode from 'vscode';
import { PullRequestService } from '../azure/PullRequestService';
import { PullRequest, PullRequestGroup } from '../models/PullRequest';
import { AuthenticationError, toUserMessage } from '../utils/errors';
import { Logger } from '../utils/logger';

const GROUP_LABELS: Record<PullRequestGroup, string> = {
  mine: 'My Pull Requests',
  assignedToMe: 'Assigned To Me',
  all: 'All Open PRs',
};

export class PullRequestGroupItem extends vscode.TreeItem {
  constructor(public readonly group: PullRequestGroup) {
    super(GROUP_LABELS[group], vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'pullRequestGroup';
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

export class PullRequestItem extends vscode.TreeItem {
  constructor(public readonly pullRequest: PullRequest) {
    super(`#${pullRequest.id} ${pullRequest.title}`, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'pullRequest';
    this.description = `${pullRequest.sourceBranch} → ${pullRequest.targetBranch}`;
    this.tooltip = new vscode.MarkdownString(
      `**#${pullRequest.id} ${pullRequest.title}**\n\n` +
        `${pullRequest.description || '_No description_'}\n\n` +
        `Author: ${pullRequest.createdBy}\n\nStatus: ${pullRequest.status}`,
    );
    this.iconPath = new vscode.ThemeIcon(
      pullRequest.isDraft ? 'git-pull-request-draft' : 'git-pull-request',
    );
    this.command = {
      command: 'azurePrReview.openPullRequest',
      title: 'Open Pull Request',
      arguments: [pullRequest],
    };
  }
}

/** A non-interactive info row shown in place of PRs, e.g. "not signed in" - never an error toast. */
export class PullRequestMessageItem extends vscode.TreeItem {
  constructor(label: string, command?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'pullRequestMessage';
    this.iconPath = new vscode.ThemeIcon(command ? 'sign-in' : 'info');
    if (command) {
      this.command = { command, title: label };
    }
  }
}

type PrTreeElement = PullRequestGroupItem | PullRequestItem | PullRequestMessageItem;

export class PullRequestTreeProvider implements vscode.TreeDataProvider<PrTreeElement> {
  private readonly logger = Logger.getInstance();
  private readonly emitter = new vscode.EventEmitter<PrTreeElement | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly service: PullRequestService) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: PrTreeElement): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PrTreeElement): Promise<PrTreeElement[]> {
    if (!element) {
      return [
        new PullRequestGroupItem('mine'),
        new PullRequestGroupItem('assignedToMe'),
        new PullRequestGroupItem('all'),
      ];
    }
    if (element instanceof PullRequestGroupItem) {
      try {
        const prs = await this.service.listPullRequests(element.group);
        return prs.map((pr) => new PullRequestItem(pr));
      } catch (err) {
        this.logger.error(`Failed to load pull requests for group "${element.group}".`, err);
        // Not being signed in isn't an error - it's the expected state right after Sign Out,
        // or before the user has signed in at all. Show a quiet inline prompt instead of a toast.
        if (err instanceof AuthenticationError) {
          return [new PullRequestMessageItem('Sign in to Azure DevOps…', 'azurePrReview.signIn')];
        }
        vscode.window.showErrorMessage(toUserMessage(err));
        return [];
      }
    }
    return [];
  }
}
