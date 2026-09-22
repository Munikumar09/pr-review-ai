import { describe, expect, it, vi } from 'vitest';
import { attachDiffStats, STATS_FILE_COUNT_THRESHOLD } from '../../azure/attachDiffStats';
import { PullRequestDiffService } from '../../azure/PullRequestDiffService';
import { PullRequestFile } from '../../models/PullRequestFile';
import { FileDiff } from '../../models/FileDiff';

type DiffServiceForStats = Pick<PullRequestDiffService, 'getFileDiff'>;

function file(path: string): PullRequestFile {
  return { path, changeType: 'edit', additions: 0, deletions: 0 };
}

function diffFor(path: string, additions: number, deletions: number): FileDiff {
  return { path, oldContent: '', newContent: '', patch: '', additions, deletions };
}

describe('attachDiffStats', () => {
  it('fills in real additions/deletions computed from the diff, replacing the API-reported 0/0', async () => {
    const files = [file('a.ts'), file('b.ts')];
    const getFileDiff = vi.fn(async (_prId: number, f: PullRequestFile) =>
      f.path === 'a.ts' ? diffFor('a.ts', 5, 2) : diffFor('b.ts', 0, 3),
    );
    const diffService: DiffServiceForStats = { getFileDiff };

    await attachDiffStats(diffService as PullRequestDiffService, 1, files);

    expect(files[0]).toMatchObject({ additions: 5, deletions: 2 });
    expect(files[1]).toMatchObject({ additions: 0, deletions: 3 });
  });

  it('leaves a file at 0/0 if computing its diff fails, without throwing', async () => {
    const files = [file('broken.ts')];
    const getFileDiff = vi.fn(async () => {
      throw new Error('network error');
    });
    const diffService: DiffServiceForStats = { getFileDiff };

    await expect(
      attachDiffStats(diffService as PullRequestDiffService, 1, files),
    ).resolves.not.toThrow();
    expect(files[0]).toMatchObject({ additions: 0, deletions: 0 });
  });

  it('skips the fetch entirely for very large PRs to stay responsive', async () => {
    const files = Array.from({ length: STATS_FILE_COUNT_THRESHOLD + 1 }, (_, i) =>
      file(`f${i}.ts`),
    );
    const getFileDiff = vi.fn(async (_prId: number, f: PullRequestFile) => diffFor(f.path, 1, 1));
    const diffService: DiffServiceForStats = { getFileDiff };

    await attachDiffStats(diffService as PullRequestDiffService, 1, files);

    expect(getFileDiff).not.toHaveBeenCalled();
    expect(files[0]).toMatchObject({ additions: 0, deletions: 0 });
  });
});
