import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  ApprovalManager,
  CommentServiceForApproval,
  isDuplicateOfExisting,
  formatFindingAsComment,
} from '../../review/ApprovalManager';
import { ReviewState } from '../../review/ReviewState';
import { StateStore } from '../../storage/StateStore';
import { ReviewFinding } from '../../models/ReviewFinding';
import { PullRequestComment } from '../../models/PullRequestComment';
import { ReviewSession } from '../../models/ReviewSession';

function makeStateStore(): StateStore {
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

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: 'f1',
    severity: 'high',
    category: 'bug',
    title: 'Possible null dereference',
    description: 'Value may be null before use.',
    filePath: 'src/app.ts',
    startLine: 10,
    endLine: 10,
    confidence: 0.9,
    provider: 'mock',
    status: 'approved',
    rightFileStartLine: 10,
    rightFileEndLine: 10,
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
    completedAt: new Date().toISOString(),
    findings,
    filesReviewed: 1,
    filesSkipped: 0,
  };
}

describe('isDuplicateOfExisting', () => {
  it('flags a finding that closely matches an existing comment on the same file/line', () => {
    const existing: PullRequestComment[] = [
      {
        id: 1,
        threadId: 1,
        author: 'Bob',
        content: 'Possible null dereference here, value may be null before use.',
        status: 'active',
        filePath: 'src/app.ts',
        startLine: 11,
        publishedDate: new Date().toISOString(),
      },
    ];
    expect(isDuplicateOfExisting(finding(), existing)).toBe(true);
  });

  it('does not flag findings on a different file', () => {
    const existing: PullRequestComment[] = [
      {
        id: 1,
        threadId: 1,
        author: 'Bob',
        content: 'Possible null dereference here, value may be null before use.',
        status: 'active',
        filePath: 'src/other.ts',
        startLine: 10,
        publishedDate: new Date().toISOString(),
      },
    ];
    expect(isDuplicateOfExisting(finding(), existing)).toBe(false);
  });

  it('does not flag unrelated comments on the same line', () => {
    const existing: PullRequestComment[] = [
      {
        id: 1,
        threadId: 1,
        author: 'Bob',
        content: 'nit: rename this variable for clarity',
        status: 'active',
        filePath: 'src/app.ts',
        startLine: 10,
        publishedDate: new Date().toISOString(),
      },
    ];
    expect(isDuplicateOfExisting(finding(), existing)).toBe(false);
  });
});

describe('formatFindingAsComment', () => {
  it('includes severity, title, description and confidence by default', () => {
    const text = formatFindingAsComment(finding());
    expect(text).toContain('HIGH');
    expect(text).toContain('AI Review');
    expect(text).toContain('Possible null dereference');
    expect(text).toContain('90%');
    expect(text).toContain('mock');
  });

  it('strips severity/category label, confidence and provider when attribution is disabled', () => {
    const text = formatFindingAsComment(finding(), { includeAttribution: false });
    expect(text).toContain('Possible null dereference');
    expect(text).toContain('Value may be null before use');
    expect(text).not.toContain('AI Review');
    expect(text).not.toContain('HIGH');
    expect(text).not.toContain('Confidence');
    expect(text).not.toContain('90%');
    expect(text).not.toContain('mock');
  });

  it('still includes the suggested fix even with attribution disabled', () => {
    const text = formatFindingAsComment(finding({ suggestedFix: 'Add a null check.' }), {
      includeAttribution: false,
    });
    expect(text).toContain('Add a null check');
  });
});

describe('ApprovalManager.publishApproved', () => {
  it('publishes approved findings and never touches rejected ones', async () => {
    const state = new ReviewState(makeStateStore());
    await state.set(
      session([
        finding({ id: 'approved-1', status: 'approved' }),
        finding({ id: 'rejected-1', status: 'rejected' }),
      ]),
    );

    const addComment = vi.fn().mockResolvedValue({ id: 1, threadId: 1 } as PullRequestComment);
    const commentService: CommentServiceForApproval = {
      getThreads: vi.fn().mockResolvedValue([]),
      addComment,
    };

    const manager = new ApprovalManager(state, commentService);
    const result = await manager.publishApproved(1);

    expect(addComment).toHaveBeenCalledTimes(1);
    expect(result.published).toHaveLength(1);
    expect(result.published[0].id).toBe('approved-1');
    expect(state.get(1)?.findings.find((f) => f.id === 'rejected-1')?.status).toBe('rejected');
  });

  it('skips findings with a mapping error and never publishes them', async () => {
    const state = new ReviewState(makeStateStore());
    await state.set(
      session([finding({ id: 'unmapped-1', status: 'approved', mappingError: 'out of range' })]),
    );

    const addComment = vi.fn();
    const commentService: CommentServiceForApproval = {
      getThreads: vi.fn().mockResolvedValue([]),
      addComment,
    };

    const manager = new ApprovalManager(state, commentService);
    const result = await manager.publishApproved(1);

    expect(addComment).not.toHaveBeenCalled();
    expect(result.skippedUnmapped).toHaveLength(1);
  });

  it('skips duplicate findings against existing comments', async () => {
    const state = new ReviewState(makeStateStore());
    await state.set(session([finding({ id: 'dup-1', status: 'approved' })]));

    const addComment = vi.fn();
    const commentService: CommentServiceForApproval = {
      getThreads: vi.fn().mockResolvedValue([
        {
          id: 1,
          threadId: 1,
          author: 'Bob',
          content: 'Possible null dereference here, value may be null before use.',
          status: 'active',
          filePath: 'src/app.ts',
          startLine: 10,
          publishedDate: new Date().toISOString(),
        },
      ] as PullRequestComment[]),
      addComment,
    };

    const manager = new ApprovalManager(state, commentService);
    const result = await manager.publishApproved(1);

    expect(addComment).not.toHaveBeenCalled();
    expect(result.skippedDuplicates).toHaveLength(1);
  });

  it('with findingIds, publishes only the specified finding even when others are also approved', async () => {
    const state = new ReviewState(makeStateStore());
    await state.set(
      session([
        finding({ id: 'approved-1', status: 'approved' }),
        finding({ id: 'approved-2', status: 'approved' }),
      ]),
    );

    const addComment = vi.fn().mockResolvedValue({ id: 1, threadId: 1 } as PullRequestComment);
    const commentService: CommentServiceForApproval = {
      getThreads: vi.fn().mockResolvedValue([]),
      addComment,
    };

    const manager = new ApprovalManager(state, commentService);
    const result = await manager.publishApproved(1, { findingIds: ['approved-1'] });

    expect(addComment).toHaveBeenCalledTimes(1);
    expect(result.published.map((f) => f.id)).toEqual(['approved-1']);
    expect(state.get(1)?.findings.find((f) => f.id === 'approved-2')?.status).toBe('approved');
  });

  it('publishes a plain comment with no AI attribution when configured to do so', async () => {
    const state = new ReviewState(makeStateStore());
    await state.set(session([finding({ id: 'approved-1', status: 'approved' })]));

    let publishedContent = '';
    const commentService: CommentServiceForApproval = {
      getThreads: vi.fn().mockResolvedValue([]),
      addComment: vi
        .fn()
        .mockImplementation(async (_prId: number, request: { content: string }) => {
          publishedContent = request.content;
          return { id: 1, threadId: 1 } as PullRequestComment;
        }),
    };

    const manager = new ApprovalManager(state, commentService, () => false);
    await manager.publishApproved(1);

    expect(publishedContent).not.toContain('AI Review');
    expect(publishedContent).not.toContain('Confidence');
    expect(publishedContent).toContain('Possible null dereference');
  });
});

it('never publishes an edited finding without a new explicit approval', async () => {
  const state = new ReviewState(makeStateStore());
  await state.set(session([finding({ status: 'edited' })]));
  const addComment = vi.fn();
  const manager = new ApprovalManager(state, { getThreads: vi.fn(async () => []), addComment });
  expect(manager.getSummary(1).readyToPublish).toBe(0);
  await manager.publishApproved(1);
  expect(addComment).not.toHaveBeenCalled();
});

it('rechecks approval after an asynchronous fetch and preserves the edit', async () => {
  const state = new ReviewState(makeStateStore());
  await state.set(session([finding()]));
  const addComment = vi.fn();
  const manager = new ApprovalManager(state, {
    getThreads: vi.fn(async () => {
      await state.set(session([finding({ status: 'edited', description: 'New unapproved text' })]));
      return [];
    }),
    addComment,
  });
  await manager.publishApproved(1);
  expect(addComment).not.toHaveBeenCalled();
  expect(state.get(1)?.findings[0].description).toBe('New unapproved text');
});

it('prevents concurrent publication of the same approved finding', async () => {
  const state = new ReviewState(makeStateStore());
  await state.set(session([finding()]));
  const addComment = vi.fn(async () => ({ id: 1, threadId: 1 }) as PullRequestComment);
  const manager = new ApprovalManager(state, { getThreads: vi.fn(async () => []), addComment });
  await Promise.all([manager.publishApproved(1), manager.publishApproved(1)]);
  expect(addComment).toHaveBeenCalledOnce();
});

it('publishes reviewed AI text literally without active Markdown images or HTML', () => {
  const text = formatFindingAsComment(
    finding({ description: '![leak](https://evil.test/private) <img src="https://evil.test">' }),
  );
  expect(text).not.toContain('![leak](');
  expect(text).not.toContain('<img');
  expect(text).toContain('&lt;img');
});
