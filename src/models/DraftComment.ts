/**
 * A human-authored review comment the user has written but not yet published to Azure DevOps.
 * Lets someone add any number of comments while reviewing, then publish them all at once
 * (mirrors the AI findings' approve-then-publish gate, but for manually-written comments).
 */
export interface DraftComment {
  id: string;
  pullRequestId: number;
  filePath: string;
  content: string;
  /** 1-based line in the "right" (new/target) file version, when applicable. */
  rightFileStartLine?: number;
  rightFileEndLine?: number;
  /** 1-based line in the "left" (old/base) file version, when applicable. */
  leftFileStartLine?: number;
  leftFileEndLine?: number;
  createdAt: string;
}
