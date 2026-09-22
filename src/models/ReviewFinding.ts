export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type FindingCategory =
  'bug' | 'security' | 'performance' | 'maintainability' | 'testing' | 'style' | 'other';

export type FindingStatus = 'pending' | 'approved' | 'rejected' | 'edited' | 'published';

export interface ReviewFinding {
  id: string;
  severity: FindingSeverity;
  category: FindingCategory;
  title: string;
  description: string;
  filePath: string;
  startLine: number;
  endLine: number;
  suggestedFix?: string;
  confidence: number;
  provider: string;
  status: FindingStatus;
  /** Set when the finding's line range could not be mapped to a valid Azure DevOps thread position; if set, the finding must never be published. */
  mappingError?: string;
  /** The resolved Azure DevOps thread position, set when mappingError is absent. */
  rightFileStartLine?: number;
  rightFileEndLine?: number;
  leftFileStartLine?: number;
  leftFileEndLine?: number;
}
