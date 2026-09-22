import { PullRequestService } from '../azure/PullRequestService';
import { PullRequestTreeProvider } from '../views/PullRequestTreeProvider';

export function refreshPullRequests(
  service: PullRequestService,
  tree: PullRequestTreeProvider,
): void {
  service.invalidateAll();
  tree.refresh();
}
