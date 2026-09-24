import { afterEach, describe, expect, it, vi } from 'vitest';
import { AzureDevOpsClient } from '../../azure/AzureDevOpsClient';
import { AzureDevOpsAuthProvider } from '../../azure/AzureDevOpsAuth';
import { ConfigurationError } from '../../utils/errors';

const fake = vi.hoisted(() => ({
  connect: vi.fn(async () => ({ authenticatedUser: { id: 'me' } })),
  gitApi: {
    getPullRequests: vi.fn(),
    getPullRequestById: vi.fn(),
    getPullRequestIterations: vi.fn(async () => []),
    getThreads: vi.fn(async () => []),
    createThread: vi.fn(),
    getRepositories: vi.fn(),
  },
}));

vi.mock('azure-devops-node-api', () => ({
  getPersonalAccessTokenHandler: () => ({}),
  WebApi: class {
    getGitApi = async () => fake.gitApi;
    connect = fake.connect;
  },
}));

const auth: AzureDevOpsAuthProvider = {
  getToken: async () => 'pat',
  authenticate: async () => {},
  logout: async () => {},
  onDidChangeSession: () => ({ dispose() {} }),
};

function rawPr(id: number, repository: string) {
  return {
    pullRequestId: id,
    title: `PR ${id}`,
    repository: { id: `${repository}-id`, name: repository, project: { id: 'p', name: 'proj' } },
  };
}

function client(repositories: string[]) {
  return new AzureDevOpsClient(auth, () => ({
    organization: 'org',
    project: 'proj',
    repositories,
  }));
}

describe('AzureDevOpsClient with several repositories', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sends each PR-scoped call to the repository that PR belongs to', async () => {
    fake.gitApi.getPullRequests.mockImplementation(async (repository: string) =>
      repository === 'api' ? [rawPr(7, 'api')] : [rawPr(8, 'web')],
    );
    const c = client(['api', 'web']);

    const api = await c.getPullRequests('api', 'all');
    const web = await c.getPullRequests('web', 'all');
    expect(api.map((pr) => pr.repositoryName)).toEqual(['api']);
    expect(web.map((pr) => pr.repositoryName)).toEqual(['web']);

    await c.getPullRequestThreads(7);
    await c.getPullRequestThreads(8);
    expect(fake.gitApi.getThreads.mock.calls.map((call) => call[0])).toEqual(['api-id', 'web-id']);
    expect(fake.gitApi.getPullRequestById).not.toHaveBeenCalled();
  });

  it('looks up the repository of a PR it has not listed yet', async () => {
    fake.gitApi.getPullRequestById.mockResolvedValue(rawPr(9, 'web'));
    await client(['api', 'web']).getChangedFiles(9);
    expect(fake.gitApi.getPullRequestById).toHaveBeenCalledWith(9, 'proj');
    expect(fake.gitApi.getPullRequestIterations).toHaveBeenCalledWith('web-id', 9, 'proj');
  });

  it('refuses PRs from repositories that are not configured', async () => {
    fake.gitApi.getPullRequestById.mockResolvedValue(rawPr(10, 'secret'));
    const c = client(['api']);
    await expect(c.getPullRequest(10)).rejects.toBeInstanceOf(ConfigurationError);
    await expect(
      c.createThread(10, { content: 'x', filePath: 'a.ts', rightFileStartLine: 1 }),
    ).rejects.toBeInstanceOf(ConfigurationError);
    await expect(c.getPullRequests('secret', 'all')).rejects.toBeInstanceOf(ConfigurationError);
    expect(fake.gitApi.createThread).not.toHaveBeenCalled();
    expect(fake.gitApi.getPullRequests).not.toHaveBeenCalled();
  });

  it('stops serving an already-listed PR once its repository is removed from settings', async () => {
    fake.gitApi.getPullRequests.mockResolvedValue([rawPr(7, 'api')]);
    let repositories = ['api', 'web'];
    const c = new AzureDevOpsClient(auth, () => ({
      organization: 'org',
      project: 'proj',
      repositories,
    }));
    await c.getPullRequests('api', 'all');

    repositories = ['web'];
    await expect(c.getPullRequestThreads(7)).rejects.toBeInstanceOf(ConfigurationError);
    expect(fake.gitApi.getThreads).not.toHaveBeenCalled();
  });

  it('matches configured repositories case-insensitively', async () => {
    fake.gitApi.getPullRequests.mockResolvedValue([rawPr(7, 'API')]);
    const c = client(['api']);
    await c.getPullRequests('Api', 'all');
    await c.getPullRequestThreads(7);
    expect(fake.gitApi.getThreads).toHaveBeenCalledWith('API-id', 7, 'proj');
  });

  it('resolves the signed-in user once for every repository and group', async () => {
    fake.gitApi.getPullRequests.mockResolvedValue([]);
    const c = client(['api', 'web']);
    await Promise.all([
      c.getPullRequests('api', 'mine'),
      c.getPullRequests('api', 'assignedToMe'),
      c.getPullRequests('web', 'mine'),
    ]);
    expect(fake.connect).toHaveBeenCalledTimes(1);
    expect(fake.gitApi.getPullRequests.mock.calls[0][1]).toMatchObject({ creatorId: 'me' });
    expect(fake.gitApi.getPullRequests.mock.calls[1][1]).toMatchObject({ reviewerId: 'me' });
  });

  it('lists enabled repositories of the requested project, sorted', async () => {
    fake.gitApi.getRepositories.mockResolvedValue([
      { name: 'web' },
      { name: 'Archive', isDisabled: true },
      { name: 'api' },
    ]);
    expect(await client([]).listRepositories('other-org', 'other-proj')).toEqual(['api', 'web']);
    expect(fake.gitApi.getRepositories).toHaveBeenCalledWith('other-proj');
  });
});
