import * as vscode from 'vscode';
import * as path from 'path';
import { PullRequestService } from '../azure/PullRequestService';
import { PullRequestDiffService } from '../azure/PullRequestDiffService';
import { attachDiffStats } from '../azure/attachDiffStats';
import { PullRequest } from '../models/PullRequest';
import { FileTreeNode, PullRequestFile } from '../models/PullRequestFile';
import { buildFileTree } from '../diff/DiffTreeProvider';
import { toUserMessage } from '../utils/errors';
import { Logger } from '../utils/logger';

const CHANGE_TYPE_ICON: Record<PullRequestFile['changeType'], string> = {
  add: 'diff-added',
  edit: 'diff-modified',
  delete: 'diff-removed',
  rename: 'diff-renamed',
  unknown: 'file',
};

export class FolderItem extends vscode.TreeItem {
  constructor(
    public readonly node: FileTreeNode,
    public readonly pullRequest: PullRequest,
  ) {
    super(node.name, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'changedFilesFolder';
    this.iconPath = vscode.ThemeIcon.Folder;
  }
}

export class ChangedFileItem extends vscode.TreeItem {
  constructor(
    public readonly node: FileTreeNode,
    public readonly pullRequest: PullRequest,
  ) {
    super(node.name, vscode.TreeItemCollapsibleState.None);
    const file = node.file!;
    this.contextValue = 'changedFile';
    this.description = `+${file.additions} -${file.deletions}`;
    this.tooltip = `${file.path}\n${file.changeType}${file.originalPath ? ` (from ${file.originalPath})` : ''}`;
    this.resourceUri = vscode.Uri.file(file.path);
    this.iconPath = new vscode.ThemeIcon(CHANGE_TYPE_ICON[file.changeType]);
    this.command = {
      command: 'azurePrReview.openChangedFile',
      title: 'Open Diff',
      arguments: [pullRequest, file],
    };
  }
}

type ChangedFileTreeElement = FolderItem | ChangedFileItem;

/** Displays the PR's changed files hierarchically (requirement #11). */
export class ChangedFilesTreeProvider implements vscode.TreeDataProvider<ChangedFileTreeElement> {
  private readonly logger = Logger.getInstance();
  private readonly emitter = new vscode.EventEmitter<ChangedFileTreeElement | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  private pullRequest: PullRequest | undefined;
  private treeCache: FileTreeNode[] | undefined;

  constructor(
    private readonly service: PullRequestService,
    private readonly diffService: PullRequestDiffService,
  ) {}

  setPullRequest(pr: PullRequest | undefined): void {
    this.pullRequest = pr;
    this.treeCache = undefined;
    this.emitter.fire();
  }

  getCurrentPullRequest(): PullRequest | undefined {
    return this.pullRequest;
  }

  refresh(): void {
    this.treeCache = undefined;
    this.emitter.fire();
  }

  getTreeItem(element: ChangedFileTreeElement): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ChangedFileTreeElement): Promise<ChangedFileTreeElement[]> {
    if (!this.pullRequest) {
      return [];
    }
    const pr = this.pullRequest;

    if (!element) {
      if (!this.treeCache) {
        try {
          const files = await this.service.getChangedFiles(pr.id);
          await attachDiffStats(this.diffService, pr.id, files);
          this.treeCache = buildFileTree(files);
        } catch (err) {
          this.logger.error(`Failed to load changed files for PR #${pr.id}.`, err);
          vscode.window.showErrorMessage(toUserMessage(err));
          this.treeCache = [];
        }
      }
      return this.treeCache.map((node) => toTreeElement(node, pr));
    }

    return element.node.children.map((child) => toTreeElement(child, pr));
  }
}

function toTreeElement(node: FileTreeNode, pr: PullRequest): ChangedFileTreeElement {
  return node.isFile ? new ChangedFileItem(node, pr) : new FolderItem(node, pr);
}

export function baseName(filePath: string): string {
  return path.basename(filePath);
}
