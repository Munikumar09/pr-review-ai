export type ChangeType = 'add' | 'edit' | 'delete' | 'rename' | 'unknown';

export interface PullRequestFile {
  path: string;
  changeType: ChangeType;
  additions: number;
  deletions: number;
  originalPath?: string;
  objectId?: string;
  originalObjectId?: string;
}

/** A node in the folder/file hierarchy built from a flat PullRequestFile[] list. */
export interface FileTreeNode {
  name: string;
  fullPath: string;
  isFile: boolean;
  file?: PullRequestFile;
  children: FileTreeNode[];
}
