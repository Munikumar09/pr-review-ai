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

export class RepositoryItem extends vscode.TreeItem {
  constructor(public readonly repository: string) {
    super(repository, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `repository:${repository.toLowerCase()}`;
    this.contextValue = 'repository';
    this.iconPath = new vscode.ThemeIcon('repo');
  }
}

export class PullRequestGroupItem extends vscode.TreeItem {
  constructor(
    public readonly repository: string,
    public readonly group: PullRequestGroup,
  ) {
    super(GROUP_LABELS[group], vscode.TreeItemCollapsibleState.Expanded);
    // Stable ids keep each repository's expand/collapse state across refreshes.
    this.id = `group:${repository.toLowerCase()}:${group}`;
    this.contextValue = 'pullRequestGroup';
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

export class PullRequestItem extends vscode.TreeItem {
  constructor(public readonly pullRequest: PullRequest) {
    super(`#${pullRequest.id} ${pullRequest.title}`, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'pullRequest';
    this.description = `${pullRequest.sourceBranch} → ${pullRequest.targetBranch}`;
    this.tooltip = new vscode.MarkdownString().appendText(
      `#${pullRequest.id} ${pullRequest.title}\n\n` +
        `${pullRequest.description || 'No description'}\n\n` +
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
  constructor(label: string, command?: string, icon = command ? 'sign-in' : 'info') {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'pullRequestMessage';
    this.iconPath = new vscode.ThemeIcon(icon);
    if (command) {
      this.command = { command, title: label };
    }
  }
}

type PrTreeElement =
  RepositoryItem | PullRequestGroupItem | PullRequestItem | PullRequestMessageItem;

const GROUPS: PullRequestGroup[] = ['mine', 'assignedToMe', 'all'];

export class PullRequestTreeProvider implements vscode.TreeDataProvider<PrTreeElement> {
  private readonly logger = Logger.getInstance();
  private readonly emitter = new vscode.EventEmitter<PrTreeElement | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(
    private readonly service: PullRequestService,
    /** Read on every render so adding/removing repositories applies without a reload. */
    private readonly getRepositories: () => string[],
  ) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: PrTreeElement): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PrTreeElement): Promise<PrTreeElement[]> {
    if (!element) {
      const repositories = this.getRepositories();
      if (repositories.length === 0) {
        return [
          new PullRequestMessageItem('Configure Azure DevOps…', 'azurePrReview.configure', 'gear'),
        ];
      }
      // A single repository keeps the flat layout; several get one node each.
      return repositories.length === 1
        ? GROUPS.map((group) => new PullRequestGroupItem(repositories[0], group))
        : repositories.map((repository) => new RepositoryItem(repository));
    }
    if (element instanceof RepositoryItem) {
      return GROUPS.map((group) => new PullRequestGroupItem(element.repository, group));
    }
    if (element instanceof PullRequestGroupItem) {
      try {
        const prs = await this.service.listPullRequests(element.repository, element.group);
        return prs.map((pr) => new PullRequestItem(pr));
      } catch (err) {
        this.logger.error(
          `Failed to load pull requests for "${element.repository}" group "${element.group}".`,
          err,
        );
        // Not being signed in isn't an error - it's the expected state right after Sign Out,
        // or before the user has signed in at all. Show a quiet inline prompt instead of a toast.
        if (err instanceof AuthenticationError) {
          return [new PullRequestMessageItem('Sign in to Azure DevOps…', 'azurePrReview.signIn')];
        }
        // Inline rather than a toast: with several repositories, one failure per group would
        // otherwise stack up a pile of identical notifications.
        return [new PullRequestMessageItem(toUserMessage(err), undefined, 'warning')];
      }
    }
    return [];
  }
}
