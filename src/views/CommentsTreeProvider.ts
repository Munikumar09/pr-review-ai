import * as vscode from 'vscode';
import { PullRequestCommentService } from '../azure/PullRequestCommentService';
import { DraftCommentManager } from '../review/DraftCommentManager';
import { PullRequest } from '../models/PullRequest';
import { PullRequestComment } from '../models/PullRequestComment';
import { DraftComment } from '../models/DraftComment';
import { toUserMessage } from '../utils/errors';
import { Logger } from '../utils/logger';

export class CommentFileGroupItem extends vscode.TreeItem {
  constructor(
    public readonly filePath: string,
    public readonly comments: PullRequestComment[],
  ) {
    super(filePath, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'commentFileGroup';
    this.description = `${comments.length} comment${comments.length === 1 ? '' : 's'}`;
    this.iconPath = vscode.ThemeIcon.File;
  }
}

export class CommentItem extends vscode.TreeItem {
  constructor(
    public readonly comment: PullRequestComment,
    public readonly pullRequest: PullRequest,
  ) {
    super(truncate(comment.content, 80), vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'comment';
    this.description = `${comment.author} · line ${comment.startLine ?? '-'} · ${comment.status}`;
    this.tooltip = new vscode.MarkdownString(comment.content);
    this.iconPath = new vscode.ThemeIcon('comment');
    if (comment.filePath) {
      this.command = {
        command: 'azurePrReview.openChangedFile',
        title: 'Open Comment',
        arguments: [pullRequest, { path: comment.filePath }, comment.startLine ?? 1],
      };
    }
  }
}

export class DraftGroupItem extends vscode.TreeItem {
  constructor(public readonly drafts: DraftComment[]) {
    super('Draft Comments (not yet published)', vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'draftCommentGroup';
    this.description = `${drafts.length}`;
    this.iconPath = new vscode.ThemeIcon('edit');
  }
}

export class DraftCommentItem extends vscode.TreeItem {
  constructor(
    public readonly draft: DraftComment,
    public readonly pullRequest: PullRequest,
  ) {
    super(truncate(draft.content, 80), vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'draftComment';
    const line = draft.rightFileStartLine ?? draft.leftFileStartLine;
    this.description = `${draft.filePath} · line ${line ?? '-'}`;
    this.tooltip = new vscode.MarkdownString(draft.content);
    this.iconPath = new vscode.ThemeIcon('edit');
    this.command = {
      command: 'azurePrReview.openChangedFile',
      title: 'Open Draft Comment',
      arguments: [pullRequest, { path: draft.filePath }, line ?? 1],
    };
  }
}

type CommentTreeElement = CommentFileGroupItem | CommentItem | DraftGroupItem | DraftCommentItem;

/** Displays draft (unpublished) comments plus existing Azure DevOps PR threads, grouped by file (requirement #15). */
export class CommentsTreeProvider implements vscode.TreeDataProvider<CommentTreeElement> {
  private readonly logger = Logger.getInstance();
  private readonly emitter = new vscode.EventEmitter<CommentTreeElement | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  private pullRequest: PullRequest | undefined;

  constructor(
    private readonly service: PullRequestCommentService,
    private readonly draftManager: DraftCommentManager,
  ) {
    this.draftManager.onDidChange(() => this.refresh());
  }

  setPullRequest(pr: PullRequest | undefined): void {
    this.pullRequest = pr;
    this.emitter.fire();
  }

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: CommentTreeElement): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: CommentTreeElement): Promise<CommentTreeElement[]> {
    if (!this.pullRequest) {
      return [];
    }
    const pr = this.pullRequest;

    if (!element) {
      const groups: CommentTreeElement[] = [];
      const drafts = this.draftManager.list(pr.id);
      if (drafts.length > 0) {
        groups.push(new DraftGroupItem(drafts));
      }
      try {
        const comments = await this.service.getThreads(pr.id);
        const byFile = new Map<string, PullRequestComment[]>();
        for (const comment of comments) {
          const key = comment.filePath ?? 'General';
          const list = byFile.get(key) ?? [];
          list.push(comment);
          byFile.set(key, list);
        }
        groups.push(
          ...Array.from(byFile.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([filePath, list]) => new CommentFileGroupItem(filePath, list)),
        );
      } catch (err) {
        this.logger.error(`Failed to load comments for PR #${pr.id}.`, err);
        vscode.window.showErrorMessage(toUserMessage(err));
      }
      return groups;
    }

    if (element instanceof DraftGroupItem) {
      return element.drafts.map((d) => new DraftCommentItem(d, pr));
    }

    if (element instanceof CommentFileGroupItem) {
      return element.comments.map((c) => new CommentItem(c, pr));
    }

    return [];
  }
}

function truncate(text: string, max: number): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length > max ? `${singleLine.slice(0, max)}...` : singleLine;
}
