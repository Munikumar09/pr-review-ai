import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ReviewPanelProvider } from '../../webview/ReviewPanelProvider';
import { FindingManager } from '../../review/FindingManager';
import { ReviewState } from '../../review/ReviewState';
import { PullRequestService } from '../../azure/PullRequestService';
import { PullRequestDiffService } from '../../azure/PullRequestDiffService';
import { ApprovalManager, PublishSummary } from '../../review/ApprovalManager';
import { ReviewManager } from '../../review/ReviewManager';
import { DiffManager } from '../../diff/DiffManager';
import { PullRequest } from '../../models/PullRequest';
import { PullRequestFile } from '../../models/PullRequestFile';
import { ReviewSession } from '../../models/ReviewSession';
import { FileDiff } from '../../models/FileDiff';
import { ReviewFinding } from '../../models/ReviewFinding';

type PrServiceFake = Pick<
  PullRequestService,
  'getPullRequest' | 'getChangedFiles' | 'invalidatePullRequest'
>;
type DiffServiceFake = Pick<PullRequestDiffService, 'getFileDiff'>;
type ApprovalManagerFake = Pick<ApprovalManager, 'getSummary'>;
type ReviewStateFake = Pick<ReviewState, 'get' | 'set' | 'clear' | 'onDidChange'> & {
  sessions: Map<number, ReviewSession>;
};

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

function file(path: string): PullRequestFile {
  return { path, changeType: 'edit', additions: 0, deletions: 0 };
}

function finding(id: string): ReviewFinding {
  return {
    id,
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
  };
}

function session(pullRequestId: number, findingId: string): ReviewSession {
  return {
    id: 's1',
    pullRequestId,
    provider: 'mock',
    status: 'completed',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    findings: [finding(findingId)],
    filesReviewed: 1,
    filesSkipped: 0,
  };
}

function fakeReviewState(): ReviewStateFake {
  const sessions = new Map<number, ReviewSession>();
  const emitter = new vscode.EventEmitter<number>();
  return {
    sessions,
    get: (id: number) => sessions.get(id),
    set: async (s: ReviewSession) => {
      sessions.set(s.pullRequestId, s);
      emitter.fire(s.pullRequestId);
    },
    clear: async (id: number) => {
      sessions.delete(id);
      emitter.fire(id);
    },
    onDidChange: emitter.event,
  };
}

describe('ReviewPanelProvider refresh caching', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not re-fetch/re-diff changed files just because a finding was removed', async () => {
    const getChangedFiles = vi.fn(async () => [file('a.ts')]);
    const getFileDiff = vi.fn(async (): Promise<FileDiff> => ({
      path: 'a.ts',
      oldContent: '',
      newContent: '',
      patch: '',
      additions: 1,
      deletions: 1,
    }));
    const prService: PrServiceFake = {
      getPullRequest: vi.fn(async () => pullRequest()),
      getChangedFiles,
      invalidatePullRequest: vi.fn(),
    };
    const diffService: DiffServiceFake = { getFileDiff };
    const reviewStateFake = fakeReviewState();
    const findingManager = new FindingManager(reviewStateFake as unknown as ReviewState);
    const approvalManager: ApprovalManagerFake = {
      getSummary: (): PublishSummary => ({
        approved: 0,
        rejected: 0,
        pending: 1,
        readyToPublish: 0,
      }),
    };

    const createWebviewPanelSpy = vi.spyOn(vscode.window, 'createWebviewPanel');

    const provider = new ReviewPanelProvider(
      prService as unknown as PullRequestService,
      diffService as unknown as PullRequestDiffService,
      {} as unknown as ReviewManager,
      findingManager,
      approvalManager as unknown as ApprovalManager,
      reviewStateFake as unknown as ReviewState,
      {} as unknown as DiffManager,
    );

    const pr = pullRequest();
    await reviewStateFake.set(session(pr.id, 'f1'));

    await provider.show(pr);
    expect(getChangedFiles).toHaveBeenCalledTimes(1);
    expect(getFileDiff).toHaveBeenCalledTimes(1);

    interface FakePanelHandle {
      __test: { postMessage: (message: unknown) => void };
    }
    const fakePanel = createWebviewPanelSpy.mock.results[0]?.value as FakePanelHandle;

    fakePanel.__test.postMessage({ type: 'remove', findingId: 'f1' });

    await vi.waitFor(() => {
      expect(reviewStateFake.sessions.get(pr.id)?.findings).toHaveLength(0);
    });

    // The finding's status changed, but the changed-files list and its diff stats did not -
    // they must not be re-fetched/re-diffed over the network for a pure state-only action.
    expect(getChangedFiles).toHaveBeenCalledTimes(1);
    expect(getFileDiff).toHaveBeenCalledTimes(1);
  });
});
