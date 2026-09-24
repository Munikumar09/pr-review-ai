import * as vscode from 'vscode';
import { PullRequest } from '../models/PullRequest';
import { buildDiffUri, parseDiffUri, ParsedDiffUri } from '../diff/DiffContentProvider';
import { GitRepository, LocalRepositoryLocator } from '../local/LocalRepositoryLocator';
import { shortBranchName, toRepoRelativeSegments } from '../utils/azureRemote';
import { toUserMessage } from '../utils/errors';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

interface LocalTarget {
  parsed: ParsedDiffUri;
  pullRequest: PullRequest;
  repository: GitRepository;
  localUri: vscode.Uri;
}

/** Resolves the PR diff document the command was invoked on (title button arg or active editor). */
function resolveDiffDocument(arg: unknown): ParsedDiffUri | undefined {
  const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
  return uri ? parseDiffUri(uri) : undefined;
}

async function resolveLocalTarget(
  arg: unknown,
  currentPullRequest: PullRequest | undefined,
  organization: string,
  locator: LocalRepositoryLocator,
): Promise<LocalTarget | undefined> {
  const parsed = resolveDiffDocument(arg);
  if (!parsed || !currentPullRequest || currentPullRequest.id !== parsed.pullRequestId) {
    vscode.window.showWarningMessage('Open a file from a pull request diff first.');
    return undefined;
  }
  const segments = toRepoRelativeSegments(parsed.filePath);
  if (!segments) {
    vscode.window.showWarningMessage(`Cannot map "${parsed.filePath}" to a local file.`);
    return undefined;
  }
  const repository = await locator.find(currentPullRequest, organization);
  if (!repository) {
    vscode.window.showWarningMessage(
      `No open workspace folder is a clone of ${currentPullRequest.projectName}/${currentPullRequest.repositoryName}. Open the local clone in this window to use its language features.`,
    );
    return undefined;
  }
  const localUri = vscode.Uri.joinPath(repository.rootUri, ...segments);
  try {
    await vscode.workspace.fs.stat(localUri);
  } catch {
    vscode.window.showWarningMessage(
      `"${segments.join('/')}" does not exist in the local checkout${branchHint(repository, currentPullRequest)}.`,
    );
    return undefined;
  }
  return { parsed, pullRequest: currentPullRequest, repository, localUri };
}

function branchHint(repository: GitRepository, pullRequest: PullRequest): string {
  const head = repository.state.HEAD?.name;
  const source = shortBranchName(pullRequest.sourceBranch);
  return head && head !== source ? ` (checked out: ${head}, PR branch: ${source})` : '';
}

/** Local files only match the PR when its source branch is checked out - say so, but don't block. */
function warnIfBranchDiffers(target: LocalTarget): void {
  const head = target.repository.state.HEAD?.name;
  const source = shortBranchName(target.pullRequest.sourceBranch);
  if (head && head !== source) {
    void vscode.window.showInformationMessage(
      `The local clone is on "${head}", not the PR branch "${source}". Line numbers and code may differ from the pull request.`,
    );
  }
}

/** Opens the working-tree copy of the file being reviewed, at the line the reviewer is on. */
export async function openLocalFile(
  arg: unknown,
  currentPullRequest: PullRequest | undefined,
  organization: string,
  locator: LocalRepositoryLocator,
): Promise<void> {
  try {
    const target = await resolveLocalTarget(arg, currentPullRequest, organization, locator);
    if (!target) {
      return;
    }
    const line = vscode.window.activeTextEditor?.selection.active.line ?? 0;
    const position = new vscode.Position(line, 0);
    await vscode.window.showTextDocument(target.localUri, {
      preview: false,
      selection: new vscode.Range(position, position),
    });
    warnIfBranchDiffers(target);
  } catch (err) {
    logger.error('Failed to open local file.', err);
    vscode.window.showErrorMessage(toUserMessage(err));
  }
}

/** Diffs the PR version of the file (the side being viewed) against the local working copy. */
export async function compareWithLocalFile(
  arg: unknown,
  currentPullRequest: PullRequest | undefined,
  organization: string,
  locator: LocalRepositoryLocator,
): Promise<void> {
  try {
    const target = await resolveLocalTarget(arg, currentPullRequest, organization, locator);
    if (!target) {
      return;
    }
    const { parsed } = target;
    const prUri = buildDiffUri(parsed.pullRequestId, parsed.side, parsed.filePath);
    const label = parsed.side === 'old' ? 'Base' : 'PR';
    await vscode.commands.executeCommand(
      'vscode.diff',
      prUri,
      target.localUri,
      `${label} #${parsed.pullRequestId} ↔ Local: ${parsed.filePath}`,
    );
    warnIfBranchDiffers(target);
  } catch (err) {
    logger.error('Failed to compare with local file.', err);
    vscode.window.showErrorMessage(toUserMessage(err));
  }
}
