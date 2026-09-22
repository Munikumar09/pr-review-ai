import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { addCommentFromContextMenu, handleNativeCommentReply } from '../../commands/addComment';
import { DIFF_SCHEME } from '../../diff/DiffContentProvider';
import { DraftCommentManager } from '../../review/DraftCommentManager';
import { PullRequestCommentService } from '../../azure/PullRequestCommentService';
import { NewThreadRequest } from '../../azure/AzureDevOpsClient';
import { DraftComment } from '../../models/DraftComment';
import { PullRequest } from '../../models/PullRequest';
import { PullRequestFile } from '../../models/PullRequestFile';

type CommentServiceForReply = Pick<PullRequestCommentService, 'reply'>;
type DraftManagerFake = Pick<DraftCommentManager, 'add' | 'edit' | 'list'>;

function fakeThread(startLine: number, endLine: number): vscode.CommentThread {
  return {
    uri: { scheme: DIFF_SCHEME, path: '/42/new/db.py' } as vscode.Uri,
    range: { start: { line: startLine }, end: { line: endLine } } as vscode.Range,
    comments: [],
    label: undefined,
  } as unknown as vscode.CommentThread;
}

function fakeDraftManager(): DraftManagerFake & { drafts: DraftComment[] } {
  const drafts: DraftComment[] = [];
  let counter = 0;
  return {
    drafts,
    add: vi.fn(async (pullRequestId: number, request: NewThreadRequest) => {
      const draft: DraftComment = {
        id: `d${++counter}`,
        pullRequestId,
        filePath: request.filePath,
        content: request.content,
        rightFileStartLine: request.rightFileStartLine,
        rightFileEndLine: request.rightFileEndLine,
        leftFileStartLine: request.leftFileStartLine,
        leftFileEndLine: request.leftFileEndLine,
        createdAt: new Date().toISOString(),
      };
      drafts.push(draft);
      return draft;
    }),
    edit: vi.fn(async (_pullRequestId: number, draftId: string, content: string) => {
      const draft = drafts.find((d) => d.id === draftId);
      if (draft) {
        draft.content = content;
      }
    }),
    list: vi.fn((pullRequestId: number) => drafts.filter((d) => d.pullRequestId === pullRequestId)),
  };
}

function pullRequest(): PullRequest {
  return {
    id: 42,
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

function file(): PullRequestFile {
  return { path: 'db.py', changeType: 'edit', additions: 1, deletions: 0 };
}

describe('handleNativeCommentReply', () => {
  it('saves a new reply as a local draft, not published to Azure DevOps', async () => {
    const thread = fakeThread(9, 13);
    const draftManager = fakeDraftManager();
    const commentService: CommentServiceForReply = { reply: vi.fn() };

    await handleNativeCommentReply(draftManager as unknown as DraftCommentManager, commentService, {
      thread,
      text: 'This whole block should be refactored.',
    });

    expect(draftManager.add).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ filePath: 'db.py', rightFileStartLine: 10, rightFileEndLine: 14 }),
    );
    expect(commentService.reply).not.toHaveBeenCalled();
    expect(thread.label).toContain('Draft');
  });

  it('forwards the full selected range for a multi-line comment', async () => {
    const thread = fakeThread(9, 13);
    const draftManager = fakeDraftManager();
    await handleNativeCommentReply(
      draftManager as unknown as DraftCommentManager,
      { reply: vi.fn() },
      { thread, text: 'multi-line' },
    );

    expect(draftManager.add).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ rightFileStartLine: 10, rightFileEndLine: 14 }),
    );
  });

  it('still works for a single-line comment (start === end)', async () => {
    const thread = fakeThread(4, 4);
    const draftManager = fakeDraftManager();
    await handleNativeCommentReply(
      draftManager as unknown as DraftCommentManager,
      { reply: vi.fn() },
      { thread, text: 'Fix this line.' },
    );

    expect(draftManager.add).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ rightFileStartLine: 5, rightFileEndLine: 5 }),
    );
  });

  it('folds a second reply on the same still-unpublished thread into the same draft', async () => {
    const thread = fakeThread(4, 4);
    const draftManager = fakeDraftManager();

    await handleNativeCommentReply(
      draftManager as unknown as DraftCommentManager,
      { reply: vi.fn() },
      { thread, text: 'First remark.' },
    );
    await handleNativeCommentReply(
      draftManager as unknown as DraftCommentManager,
      { reply: vi.fn() },
      { thread, text: 'Second remark.' },
    );

    expect(draftManager.add).toHaveBeenCalledTimes(1);
    expect(draftManager.edit).toHaveBeenCalledTimes(1);
    expect(draftManager.drafts).toHaveLength(1);
    expect(draftManager.drafts[0].content).toBe('First remark.\n\nSecond remark.');
  });
});

describe('addCommentFromContextMenu', () => {
  it('saves the comment as a draft instead of publishing it', async () => {
    vi.spyOn(vscode.window, 'showInputBox')
      .mockResolvedValueOnce('7')
      .mockResolvedValueOnce('Please add a test for this.');
    const draftManager = fakeDraftManager();

    await addCommentFromContextMenu(
      draftManager as unknown as DraftCommentManager,
      pullRequest(),
      file(),
    );

    expect(draftManager.add).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        content: 'Please add a test for this.',
        filePath: 'db.py',
        rightFileStartLine: 7,
        rightFileEndLine: 7,
      }),
    );
  });
});
