import { describe, expect, it, vi } from 'vitest';
import {
  PullRequestGroupItem,
  PullRequestItem,
  PullRequestMessageItem,
  PullRequestTreeProvider,
  RepositoryItem,
} from '../../views/PullRequestTreeProvider';
import { PullRequestService } from '../../azure/PullRequestService';
import { PullRequest } from '../../models/PullRequest';
import { ChangedFilesError } from '../../utils/errors';

function service(listPullRequests: PullRequestService['listPullRequests']): PullRequestService {
  return { listPullRequests } as unknown as PullRequestService;
}

const pr = { id: 1, title: 'Fix', sourceBranch: 'a', targetBranch: 'b' } as PullRequest;

describe('PullRequestTreeProvider', () => {
  it('keeps the flat group layout for a single repository', async () => {
    const tree = new PullRequestTreeProvider(
      service(async () => []),
      () => ['api'],
    );
    const root = await tree.getChildren();
    expect(root.every((item) => item instanceof PullRequestGroupItem)).toBe(true);
    expect(root.map((item) => (item as PullRequestGroupItem).repository)).toEqual([
      'api',
      'api',
      'api',
    ]);
  });

  it('shows one node per repository and loads each repository separately', async () => {
    const list = vi.fn(async () => [pr]);
    let repositories = ['api', 'web'];
    const tree = new PullRequestTreeProvider(service(list), () => repositories);

    const root = await tree.getChildren();
    expect(root.map((item) => (item as RepositoryItem).repository)).toEqual(['api', 'web']);

    const groups = await tree.getChildren(root[1]);
    expect(groups).toHaveLength(3);
    const prs = await tree.getChildren(groups[2]);
    expect(prs[0]).toBeInstanceOf(PullRequestItem);
    expect(list).toHaveBeenCalledWith('web', 'all');

    repositories = [];
    const [message] = await tree.getChildren();
    expect(message).toBeInstanceOf(PullRequestMessageItem);
    expect(message.command?.command).toBe('azurePrReview.configure');
  });

  it('shows a failing repository inline instead of failing the whole view', async () => {
    const tree = new PullRequestTreeProvider(
      service(async (repository) => {
        if (repository === 'web') throw new ChangedFilesError();
        return [pr];
      }),
      () => ['api', 'web'],
    );
    const [api, web] = await tree.getChildren();
    const [apiMine] = await tree.getChildren(api);
    const [webMine] = await tree.getChildren(web);
    expect((await tree.getChildren(apiMine))[0]).toBeInstanceOf(PullRequestItem);
    expect((await tree.getChildren(webMine))[0]).toBeInstanceOf(PullRequestMessageItem);
  });
});
