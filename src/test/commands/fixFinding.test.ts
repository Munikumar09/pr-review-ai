import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { fixFinding } from '../../commands/fixFinding';
import { DiffManager } from '../../diff/DiffManager';
import { PullRequest } from '../../models/PullRequest';
import { PullRequestFile } from '../../models/PullRequestFile';
import { ReviewFinding } from '../../models/ReviewFinding';
import { FileDiff } from '../../models/FileDiff';

type DiffManagerFake = Pick<DiffManager, 'openDiff' | 'revealLine'>;

function pullRequest(): PullRequest {
  return {
    id: 1,
    title: 'Add feature',
    description: '',
    status: 'active',
    isDraft: false,
    sourceBranch: 'feature/x',
    targetBranch: 'main',
    repositoryId: 'r1',
    repositoryName: 'repo',
    projectId: 'p1',
    projectName: 'proj',
    createdBy: 'dev',
    creationDate: '',
    lastUpdateDate: '',
    url: '',
    webUrl: '',
  };
}

function file(): PullRequestFile {
  return { path: 'a.ts', changeType: 'edit', additions: 1, deletions: 0 };
}

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: 'f1',
    severity: 'medium',
    category: 'bug',
    title: 'Possible null access',
    description: 'desc',
    filePath: 'a.ts',
    startLine: 5,
    endLine: 5,
    confidence: 0.8,
    provider: 'mock',
    status: 'pending',
    ...overrides,
  };
}

describe('fixFinding', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never writes to a file - it only opens the diff, reveals the line, and shows the suggestion', async () => {
    const openDiff = vi.fn(async (): Promise<FileDiff> => ({
      path: 'a.ts',
      oldContent: '',
      newContent: '',
      patch: '',
      additions: 0,
      deletions: 0,
    }));
    const revealLine = vi.fn(async () => {});
    const diffManager: DiffManagerFake = { openDiff, revealLine };
    const infoSpy = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
    const writeText = vi.spyOn(vscode.env.clipboard, 'writeText');

    await fixFinding(
      pullRequest(),
      finding({ suggestedFix: 'Add a null check before use.' }),
      file(),
      diffManager as unknown as DiffManager,
    );

    expect(openDiff).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('Add a null check before use.'),
      'Copy Suggested Fix',
    );
    // No clipboard write unless the user explicitly clicks "Copy Suggested Fix".
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies the suggested fix to the clipboard only when the user asks for it', async () => {
    const openDiff = vi.fn(async (): Promise<FileDiff> => ({
      path: 'a.ts',
      oldContent: '',
      newContent: '',
      patch: '',
      additions: 0,
      deletions: 0,
    }));
    const diffManager: DiffManagerFake = { openDiff, revealLine: vi.fn(async () => {}) };
    vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(
      'Copy Suggested Fix' as never,
    );
    const writeText = vi.spyOn(vscode.env.clipboard, 'writeText').mockResolvedValue();

    await fixFinding(
      pullRequest(),
      finding({ suggestedFix: 'Add a null check before use.' }),
      file(),
      diffManager as unknown as DiffManager,
    );

    expect(writeText).toHaveBeenCalledWith('Add a null check before use.');
  });

  it('shows a fallback message when the finding has no suggested fix', async () => {
    const openDiff = vi.fn(async (): Promise<FileDiff> => ({
      path: 'a.ts',
      oldContent: '',
      newContent: '',
      patch: '',
      additions: 0,
      deletions: 0,
    }));
    const diffManager: DiffManagerFake = { openDiff, revealLine: vi.fn(async () => {}) };
    const infoSpy = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);

    await fixFinding(
      pullRequest(),
      finding({ suggestedFix: undefined }),
      file(),
      diffManager as unknown as DiffManager,
    );

    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('no suggested fix'));
  });

  it('warns instead of opening a diff when the file cannot be found in the PR', async () => {
    const openDiff = vi.fn();
    const diffManager: DiffManagerFake = { openDiff, revealLine: vi.fn() };
    const warnSpy = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);

    await fixFinding(pullRequest(), finding(), undefined, diffManager as unknown as DiffManager);

    expect(openDiff).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });
});
