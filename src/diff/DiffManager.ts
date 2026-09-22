import * as vscode from 'vscode';
import { PullRequestDiffService } from '../azure/PullRequestDiffService';
import { PullRequestFile } from '../models/PullRequestFile';
import { FileDiff } from '../models/FileDiff';
import { DiffContentProvider, buildDiffUri } from './DiffContentProvider';
import { Logger } from '../utils/logger';

/**
 * Opens changed files using VS Code's native diff editor
 * (`vscode.diff` - requirement #12). Never builds a custom diff UI.
 */
export class DiffManager {
  private readonly logger = Logger.getInstance();

  constructor(
    private readonly diffService: PullRequestDiffService,
    private readonly contentProvider: DiffContentProvider,
  ) {}

  async openDiff(pullRequestId: number, file: PullRequestFile): Promise<FileDiff> {
    const diff = await this.diffService.getFileDiff(pullRequestId, file);

    const oldUri = buildDiffUri(pullRequestId, 'old', diff.originalPath ?? diff.path);
    const newUri = buildDiffUri(pullRequestId, 'new', diff.path);
    this.contentProvider.set(oldUri, diff.oldContent);
    this.contentProvider.set(newUri, diff.newContent);

    const title = `${diff.path} (PR #${pullRequestId})`;
    this.logger.debug(`Opening diff for ${diff.path}`);

    await vscode.commands.executeCommand('vscode.diff', oldUri, newUri, title, {
      preview: true,
    });

    return diff;
  }

  async revealLine(uri: vscode.Uri, line: number): Promise<void> {
    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.toString() === uri.toString(),
    );
    if (!editor) {
      return;
    }
    const position = new vscode.Position(Math.max(0, line - 1), 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }
}
