import { PullRequestDiffService } from './PullRequestDiffService';
import { PullRequestFile } from '../models/PullRequestFile';
import { Logger } from '../utils/logger';

/** Above this many files we skip eager per-file diff-stat fetches to stay responsive (requirement #45/#46). */
export const STATS_FILE_COUNT_THRESHOLD = 50;
const STATS_CONCURRENCY = 5;

/**
 * Fills in `additions`/`deletions` on each file by diffing its old/new content.
 * Azure DevOps's changes API never reports line counts (they always come back
 * as 0 from AzureDevOpsMapper), so anywhere that displays them - the Changed
 * Files tree, the PR review panel - must compute them from the real diff.
 * Mutates `files` in place; skipped/failed files are left at their current value.
 */
export async function attachDiffStats(
  diffService: PullRequestDiffService,
  pullRequestId: number,
  files: PullRequestFile[],
): Promise<void> {
  if (files.length === 0 || files.length > STATS_FILE_COUNT_THRESHOLD) {
    return;
  }
  const logger = Logger.getInstance();
  let index = 0;
  const worker = async (): Promise<void> => {
    while (index < files.length) {
      const file = files[index++];
      try {
        const diff = await diffService.getFileDiff(pullRequestId, file);
        file.additions = diff.additions;
        file.deletions = diff.deletions;
      } catch (err) {
        logger.warn(`Unable to compute diff stats for ${file.path}.`, err);
      }
    }
  };
  await Promise.all(Array.from({ length: STATS_CONCURRENCY }, worker));
}
