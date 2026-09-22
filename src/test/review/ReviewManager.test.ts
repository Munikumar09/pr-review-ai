import { describe, expect, it, vi } from 'vitest';
import { ReviewManager } from '../../review/ReviewManager';
import { ReviewState } from '../../review/ReviewState';
import { AIReviewOrchestrator } from '../../ai/AIReviewOrchestrator';
import { PullRequestDiffService } from '../../azure/PullRequestDiffService';
import { Configuration } from '../../config/Configuration';
import { AIReviewProvider } from '../../ai/AIReviewProvider';

describe('ReviewManager.clearReview', () => {
  it('delegates to ReviewState.clear for the given pull request, discarding its findings', async () => {
    const clear = vi.fn(async () => {});
    const state = { clear } as unknown as ReviewState;
    const manager = new ReviewManager(
      {} as unknown as AIReviewOrchestrator,
      {} as unknown as PullRequestDiffService,
      state,
      {} as unknown as Configuration,
      new Map<string, AIReviewProvider>(),
    );

    await manager.clearReview(42);

    expect(clear).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith(42);
  });
});
