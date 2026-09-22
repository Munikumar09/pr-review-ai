import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { approveFinding, approveAllAndPublish, removeFinding } from '../../commands/publishFinding';
import { FindingManager } from '../../review/FindingManager';
import { ApprovalManager, CommentServiceForApproval } from '../../review/ApprovalManager';
import { ReviewState } from '../../review/ReviewState';
import { StateStore } from '../../storage/StateStore';
import { PullRequest } from '../../models/PullRequest';
import { ReviewFinding } from '../../models/ReviewFinding';
import { ReviewSession } from '../../models/ReviewSession';
import { PullRequestComment } from '../../models/PullRequestComment';

function makeState(): ReviewState {
  const memory = new Map<string, unknown>();
  const fakeContext = {
    workspaceState: {
      get: <T>(key: string, defaultValue: T) =>
        memory.has(key) ? (memory.get(key) as T) : defaultValue,
      update: (key: string, value: unknown) => {
        memory.set(key, value);
        return Promise.resolve();
      },
    },
  };
  return new ReviewState(new StateStore(fakeContext as unknown as vscode.ExtensionContext));
}

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

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: 'f1',
    severity: 'medium',
    category: 'bug',
    title: 'Possible null access',
    description: 'desc',
    filePath: 'a.ts',
    startLine: 1,
    endLine: 1,
    confidence: 0.8,
    provider: 'mock',
    status: 'pending',
    rightFileStartLine: 1,
    rightFileEndLine: 1,
    ...overrides,
  };
}

function session(findings: ReviewFinding[]): ReviewSession {
  return {
    id: 's1',
    pullRequestId: 1,
    provider: 'mock',
    status: 'completed',
    startedAt: new Date().toISOString(),
    findings,
    filesReviewed: 1,
    filesSkipped: 0,
  };
}

describe('approveFinding', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('approves and publishes the finding immediately, without a separate publish step', async () => {
    const state = makeState();
    await state.set(session([finding()]));
    const findingManager = new FindingManager(state);
    const addComment = vi.fn().mockResolvedValue({ id: 1, threadId: 1 } as PullRequestComment);
    const commentService: CommentServiceForApproval = {
      getThreads: vi.fn().mockResolvedValue([]),
      addComment,
    };
    const approvalManager = new ApprovalManager(state, commentService);

    await approveFinding(pullRequest(), finding(), findingManager, approvalManager);

    expect(addComment).toHaveBeenCalledTimes(1);
    expect(state.get(1)?.findings[0].status).toBe('published');
  });
});

describe('removeFinding', () => {
  it('deletes the finding from the session', async () => {
    const state = makeState();
    await state.set(session([finding()]));
    const findingManager = new FindingManager(state);

    await removeFinding(pullRequest(), finding(), findingManager);

    expect(state.get(1)?.findings).toHaveLength(0);
  });
});

describe('approveAllAndPublish', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing until the user confirms the modal warning', async () => {
    const state = makeState();
    await state.set(session([finding({ id: 'f1' }), finding({ id: 'f2' })]));
    const findingManager = new FindingManager(state);
    const addComment = vi.fn().mockResolvedValue({ id: 1, threadId: 1 } as PullRequestComment);
    const commentService: CommentServiceForApproval = {
      getThreads: vi.fn().mockResolvedValue([]),
      addComment,
    };
    const approvalManager = new ApprovalManager(state, commentService);
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);

    await approveAllAndPublish(
      pullRequest(),
      state.get(1)!.findings,
      findingManager,
      approvalManager,
    );

    expect(addComment).not.toHaveBeenCalled();
    expect(state.get(1)?.findings.every((f) => f.status === 'pending')).toBe(true);
  });

  it('approves every pending/edited finding and publishes all of them once confirmed', async () => {
    const state = makeState();
    await state.set(
      session([
        finding({ id: 'f1', status: 'pending' }),
        finding({ id: 'f2', status: 'edited' }),
        finding({ id: 'f3', status: 'approved' }),
      ]),
    );
    const findingManager = new FindingManager(state);
    const addComment = vi.fn().mockResolvedValue({ id: 1, threadId: 1 } as PullRequestComment);
    const commentService: CommentServiceForApproval = {
      getThreads: vi.fn().mockResolvedValue([]),
      addComment,
    };
    const approvalManager = new ApprovalManager(state, commentService);
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Approve All (3)' as never);

    await approveAllAndPublish(
      pullRequest(),
      state.get(1)!.findings,
      findingManager,
      approvalManager,
    );

    expect(addComment).toHaveBeenCalledTimes(3);
    expect(state.get(1)?.findings.every((f) => f.status === 'published')).toBe(true);
  });
});
