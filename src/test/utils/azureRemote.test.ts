import { describe, expect, it } from 'vitest';
import {
  isSameAzureRepository,
  parseAzureRemote,
  shortBranchName,
  toRepoRelativeSegments,
} from '../../utils/azureRemote';

describe('parseAzureRemote', () => {
  const expected = { organization: 'org', project: 'My Proj', repository: 'repo' };

  it.each([
    'https://dev.azure.com/org/My%20Proj/_git/repo',
    'https://user@dev.azure.com/org/My%20Proj/_git/repo',
    'git@ssh.dev.azure.com:v3/org/My%20Proj/repo',
    'https://org.visualstudio.com/My%20Proj/_git/repo',
    'https://org.visualstudio.com/DefaultCollection/My%20Proj/_git/repo',
  ])('parses %s', (url) => {
    expect(parseAzureRemote(url)).toEqual(expected);
  });

  it('rejects non-Azure and malformed remotes', () => {
    expect(parseAzureRemote('https://github.com/org/repo.git')).toBeUndefined();
    expect(parseAzureRemote('git@github.com:org/repo.git')).toBeUndefined();
    expect(parseAzureRemote('https://dev.azure.com/org/proj')).toBeUndefined();
    expect(parseAzureRemote('not a url')).toBeUndefined();
  });
});

describe('isSameAzureRepository', () => {
  it('compares case-insensitively and ignores a .git suffix', () => {
    const remote = { organization: 'Org', project: 'Proj', repository: 'Repo.git' };
    expect(
      isSameAzureRepository(remote, { organization: 'org', project: 'proj', repository: 'repo' }),
    ).toBe(true);
    expect(
      isSameAzureRepository(remote, { organization: 'org', project: 'proj', repository: 'other' }),
    ).toBe(false);
  });
});

describe('toRepoRelativeSegments', () => {
  it('strips leading slashes', () => {
    expect(toRepoRelativeSegments('/src/a.ts')).toEqual(['src', 'a.ts']);
  });
  it('rejects traversal and empty paths', () => {
    expect(toRepoRelativeSegments('/../etc/passwd')).toBeUndefined();
    expect(toRepoRelativeSegments('/')).toBeUndefined();
  });
});

describe('shortBranchName', () => {
  it('strips refs/heads/', () => {
    expect(shortBranchName('refs/heads/feature/x')).toBe('feature/x');
    expect(shortBranchName('main')).toBe('main');
  });
});
