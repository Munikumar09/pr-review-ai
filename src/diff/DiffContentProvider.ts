import * as vscode from 'vscode';

export const DIFF_SCHEME = 'azure-pr-review-diff';

/**
 * Serves read-only virtual documents for the "old" and "new" sides of a PR
 * file diff, so VS Code's native diff editor (requirement #12) can be used
 * without writing anything to disk and without requiring the PR branch to
 * be checked out locally (requirement #13).
 */
export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  private readonly content = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  /** Registers content for a URI previously built with `buildDiffUri`. */
  set(uri: vscode.Uri, text: string): void {
    this.content.set(uri.toString(), text);
    this.emitter.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.content.get(uri.toString()) ?? '';
  }

  clear(prefix: string): void {
    for (const key of Array.from(this.content.keys())) {
      if (key.startsWith(prefix)) {
        this.content.delete(key);
      }
    }
  }
}

export interface ParsedDiffUri {
  pullRequestId: number;
  side: 'old' | 'new';
  filePath: string;
}

export function parseDiffUri(uri: vscode.Uri): ParsedDiffUri | undefined {
  if (uri.scheme !== DIFF_SCHEME) {
    return undefined;
  }
  const match = uri.path.match(/^\/(\d+)\/(old|new)\/(.+)$/);
  if (!match) {
    return undefined;
  }
  return { pullRequestId: Number(match[1]), side: match[2] as 'old' | 'new', filePath: match[3] };
}

export function buildDiffUri(
  pullRequestId: number,
  side: 'old' | 'new',
  filePath: string,
): vscode.Uri {
  return vscode.Uri.from({
    scheme: DIFF_SCHEME,
    path: `/${pullRequestId}/${side}/${filePath}`,
    query: `pr=${pullRequestId}&side=${side}`,
  });
}
