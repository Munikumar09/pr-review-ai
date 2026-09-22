export interface ThreadContext {
  filePath: string;
  /** 1-based line in the "right" (new/target) file version, when applicable. */
  rightFileStartLine?: number;
  rightFileEndLine?: number;
  /** 1-based line in the "left" (old/base) file version, when applicable. */
  leftFileStartLine?: number;
  leftFileEndLine?: number;
}

export type CommentThreadStatus =
  'active' | 'fixed' | 'wontFix' | 'closed' | 'byDesign' | 'pending' | 'unknown';

export interface PullRequestComment {
  id: number;
  threadId: number;
  author: string;
  content: string;
  status: CommentThreadStatus;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  threadContext?: ThreadContext;
  publishedDate: string;
  isDeleted?: boolean;
}
