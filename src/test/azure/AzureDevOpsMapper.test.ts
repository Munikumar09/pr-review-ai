import { describe, expect, it } from 'vitest';
import * as GitInterfaces from 'azure-devops-node-api/interfaces/GitInterfaces';
import { AzureDevOpsMapper } from '../../azure/AzureDevOpsMapper';

describe('AzureDevOpsMapper.toPullRequestStatus', () => {
  it('maps draft PRs regardless of status', () => {
    expect(
      AzureDevOpsMapper.toPullRequestStatus(GitInterfaces.PullRequestStatus.Active, true),
    ).toBe('draft');
  });

  it('maps Active/Completed/Abandoned/unknown', () => {
    expect(
      AzureDevOpsMapper.toPullRequestStatus(GitInterfaces.PullRequestStatus.Active, false),
    ).toBe('active');
    expect(
      AzureDevOpsMapper.toPullRequestStatus(GitInterfaces.PullRequestStatus.Completed, false),
    ).toBe('completed');
    expect(
      AzureDevOpsMapper.toPullRequestStatus(GitInterfaces.PullRequestStatus.Abandoned, false),
    ).toBe('abandoned');
    expect(AzureDevOpsMapper.toPullRequestStatus(undefined, false)).toBe('unknown');
  });
});

describe('AzureDevOpsMapper.toChangeType', () => {
  it('maps add/edit/delete/rename', () => {
    const t = GitInterfaces.VersionControlChangeType;
    expect(AzureDevOpsMapper.toChangeType(t.Add)).toBe('add');
    expect(AzureDevOpsMapper.toChangeType(t.Edit)).toBe('edit');
    expect(AzureDevOpsMapper.toChangeType(t.Delete)).toBe('delete');
    expect(AzureDevOpsMapper.toChangeType(t.Rename)).toBe('rename');
    expect(AzureDevOpsMapper.toChangeType(undefined)).toBe('unknown');
  });

  it('prefers rename over edit when both flags are set (renamed + edited file)', () => {
    const t = GitInterfaces.VersionControlChangeType;
    // eslint-disable-next-line no-bitwise
    expect(AzureDevOpsMapper.toChangeType(t.Rename | t.Edit)).toBe('rename');
  });
});

describe('AzureDevOpsMapper.toPullRequestComments', () => {
  it('flattens a thread into one comment per non-deleted comment', () => {
    const thread: GitInterfaces.GitPullRequestCommentThread = {
      id: 42,
      status: GitInterfaces.CommentThreadStatus.Active,
      threadContext: {
        filePath: '/src/app.ts',
        rightFileStart: { line: 10, offset: 1 },
        rightFileEnd: { line: 10, offset: 1 },
      },
      comments: [
        {
          id: 1,
          content: 'first',
          author: { displayName: 'Alice' },
          publishedDate: new Date('2024-01-01'),
        },
        { id: 2, content: 'deleted', isDeleted: true, publishedDate: new Date('2024-01-01') },
      ],
    };

    const comments = AzureDevOpsMapper.toPullRequestComments(thread);

    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      id: 1,
      threadId: 42,
      author: 'Alice',
      content: 'first',
      filePath: 'src/app.ts',
      startLine: 10,
      status: 'active',
    });
  });
});
