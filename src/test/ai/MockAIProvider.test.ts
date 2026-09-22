import { describe, expect, it } from 'vitest';
import { MockAIProvider } from '../../ai/providers/MockAIProvider';
import { ReviewContext, ReviewOptions } from '../../ai/AIReviewProvider';

function options(): ReviewOptions {
  return { mode: 'full', maxFindings: 20, minConfidence: 0.5, categories: ['bug'] };
}

describe('MockAIProvider', () => {
  const provider = new MockAIProvider();

  it('is always available', async () => {
    expect(await provider.isAvailable()).toBe(true);
  });

  it('produces deterministic findings only for files with additions', async () => {
    const context: ReviewContext = {
      pullRequest: {
        id: 1,
        title: 't',
        description: '',
        status: 'active',
        isDraft: false,
        sourceBranch: 'a',
        targetBranch: 'b',
        repositoryId: 'r',
        repositoryName: 'repo',
        projectId: 'p',
        projectName: 'proj',
        createdBy: 'x',
        creationDate: '',
        lastUpdateDate: '',
        url: '',
        webUrl: '',
      },
      files: [
        {
          path: 'a.ts',
          oldContent: '',
          newContent: 'x',
          diff: '@@ -0,0 +1 @@\n+x',
          additions: 1,
          deletions: 0,
        },
        { path: 'b.ts', oldContent: 'x', newContent: 'x', diff: '', additions: 0, deletions: 0 },
      ],
      existingComments: [],
    };

    const result = await provider.review(context, options());

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].filePath).toBe('a.ts');
    expect(result.findings[0].provider).toBe('mock');
    expect(result.findings[0].status).toBe('pending');
  });

  it('respects maxFindings', async () => {
    const context: ReviewContext = {
      pullRequest: {
        id: 1,
        title: 't',
        description: '',
        status: 'active',
        isDraft: false,
        sourceBranch: 'a',
        targetBranch: 'b',
        repositoryId: 'r',
        repositoryName: 'repo',
        projectId: 'p',
        projectName: 'proj',
        createdBy: 'x',
        creationDate: '',
        lastUpdateDate: '',
        url: '',
        webUrl: '',
      },
      files: Array.from({ length: 5 }, (_, i) => ({
        path: `f${i}.ts`,
        oldContent: '',
        newContent: 'x',
        diff: '@@ -0,0 +1 @@\n+x',
        additions: 1,
        deletions: 0,
      })),
      existingComments: [],
    };

    const result = await provider.review(context, { ...options(), maxFindings: 2 });

    expect(result.findings).toHaveLength(2);
  });
});
