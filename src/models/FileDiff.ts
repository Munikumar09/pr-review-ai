export interface FileDiff {
  path: string;
  originalPath?: string;
  oldContent: string;
  newContent: string;
  patch?: string;
  additions: number;
  deletions: number;
}
