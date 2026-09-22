import { ReviewFinding } from './ReviewFinding';

export type ReviewSessionStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export interface ReviewSession {
  id: string;
  pullRequestId: number;
  provider: string;
  status: ReviewSessionStatus;
  startedAt: string;
  completedAt?: string;
  findings: ReviewFinding[];
  filesReviewed: number;
  filesSkipped: number;
  error?: string;
}
