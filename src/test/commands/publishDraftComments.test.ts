import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  publishAllDraftComments,
  discardAllDraftComments,
  removeDraftComment,
  editDraftComment,
} from '../../commands/publishDraftComments';
import { DraftCommentManager } from '../../review/DraftCommentManager';
import { StateStore } from '../../storage/StateStore';
import { PullRequestCommentService } from '../../azure/PullRequestCommentService';
import { PullRequest } from '../../models/PullRequest';
import { PullRequestComment } from '../../models/PullRequestComment';

type CommentServiceFake = Pick<PullRequestCommentService, 'addComment'>;

function makeStore(): StateStore {
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
  return new StateStore(fakeContext as unknown as vscode.ExtensionContext);
}

function pullRequest(): PullRequest {
  return {
    id: 1,
    title: 'x',
    description: '',
    status: 'active',
    isDraft: false,
    sourceBranch: 'a',
    targetBranch: 'b',
    repositoryId: 'r',
    repositoryName: 'repo',
    projectId: 'p',
    projectName: 'proj',
    createdBy: 'dev',
    creationDate: '',
    lastUpdateDate: '',
    url: '',
    webUrl: '',
  };
}

describe('publishAllDraftComments', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing until the user confirms the modal warning', async () => {
    const draftManager = new DraftCommentManager(makeStore());
    await draftManager.add(1, { content: 'a', filePath: 'a.ts' });
    const addComment = vi.fn();
    const commentService: CommentServiceFake = { addComment };
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);

    await publishAllDraftComments(pullRequest(), draftManager, commentService);

    expect(addComment).not.toHaveBeenCalled();
    expect(draftManager.list(1)).toHaveLength(1);
  });

  it('publishes every draft and clears them all once confirmed', async () => {
    const draftManager = new DraftCommentManager(makeStore());
    await draftManager.add(1, { content: 'first', filePath: 'a.ts', rightFileStartLine: 1 });
    await draftManager.add(1, { content: 'second', filePath: 'b.ts', rightFileStartLine: 2 });
    const addComment = vi.fn().mockResolvedValue({ id: 1, threadId: 1 } as PullRequestComment);
    const commentService: CommentServiceFake = { addComment };
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Publish 2 Comment(s)');

    await publishAllDraftComments(pullRequest(), draftManager, commentService);

    expect(addComment).toHaveBeenCalledTimes(2);
    expect(draftManager.list(1)).toHaveLength(0);
  });

  it('keeps only the drafts that failed to publish, for retry', async () => {
    const draftManager = new DraftCommentManager(makeStore());
    await draftManager.add(1, { content: 'ok', filePath: 'a.ts' });
    await draftManager.add(1, { content: 'will fail', filePath: 'b.ts' });
    const addComment = vi.fn(async (_prId: number, request: { filePath: string }) => {
      if (request.filePath === 'b.ts') {
        throw new Error('network error');
      }
      return { id: 1, threadId: 1 } as PullRequestComment;
    });
    const commentService: CommentServiceFake = { addComment };
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Publish 2 Comment(s)');

    await publishAllDraftComments(pullRequest(), draftManager, commentService);

    const remaining = draftManager.list(1);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].filePath).toBe('b.ts');
  });
});

describe('discardAllDraftComments', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing until the user confirms', async () => {
    const draftManager = new DraftCommentManager(makeStore());
    await draftManager.add(1, { content: 'a', filePath: 'a.ts' });
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);

    await discardAllDraftComments(pullRequest(), draftManager);

    expect(draftManager.list(1)).toHaveLength(1);
  });

  it('clears every draft once confirmed', async () => {
    const draftManager = new DraftCommentManager(makeStore());
    await draftManager.add(1, { content: 'a', filePath: 'a.ts' });
    await draftManager.add(1, { content: 'b', filePath: 'b.ts' });
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Discard All');

    await discardAllDraftComments(pullRequest(), draftManager);

    expect(draftManager.list(1)).toHaveLength(0);
  });
});

describe('removeDraftComment / editDraftComment', () => {
  it('removeDraftComment deletes just that one draft', async () => {
    const draftManager = new DraftCommentManager(makeStore());
    const a = await draftManager.add(1, { content: 'a', filePath: 'a.ts' });
    await draftManager.add(1, { content: 'b', filePath: 'b.ts' });

    await removeDraftComment(pullRequest(), a, draftManager);

    expect(draftManager.list(1).map((d) => d.filePath)).toEqual(['b.ts']);
  });

  it('editDraftComment updates the content when the user provides new text', async () => {
    const draftManager = new DraftCommentManager(makeStore());
    const a = await draftManager.add(1, { content: 'old text', filePath: 'a.ts' });
    vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue('new text');

    await editDraftComment(pullRequest(), a, draftManager);

    expect(draftManager.list(1)[0].content).toBe('new text');
    vi.restoreAllMocks();
  });

  it('editDraftComment leaves the draft untouched if the input box is cancelled', async () => {
    const draftManager = new DraftCommentManager(makeStore());
    const a = await draftManager.add(1, { content: 'old text', filePath: 'a.ts' });
    vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue(undefined);

    await editDraftComment(pullRequest(), a, draftManager);

    expect(draftManager.list(1)[0].content).toBe('old text');
    vi.restoreAllMocks();
  });
});
