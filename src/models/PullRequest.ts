export type PullRequestStatus = 'active' | 'completed' | 'abandoned' | 'draft' | 'unknown';

export interface PullRequest {
  id: number;
  title: string;
  description: string;
  status: PullRequestStatus;
  isDraft: boolean;
  sourceBranch: string;
  targetBranch: string;
  repositoryId: string;
  repositoryName: string;
  projectId: string;
  projectName: string;
  createdBy: string;
  creationDate: string;
  lastUpdateDate: string;
  url: string;
  webUrl: string;
}

export type PullRequestGroup = 'mine' | 'assignedToMe' | 'all';
