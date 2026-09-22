import { FileTreeNode, PullRequestFile } from '../models/PullRequestFile';

/**
 * Pure builder that turns a flat list of changed files into a folder/file
 * hierarchy (requirement #11). Kept independent of vscode.TreeDataProvider
 * so it's trivially unit-testable; views/ChangedFilesTreeProvider.ts adapts
 * the resulting tree to the VS Code TreeView API.
 */
export function buildFileTree(files: PullRequestFile[]): FileTreeNode[] {
  const root: FileTreeNode = { name: '', fullPath: '', isFile: false, children: [] };

  for (const file of files) {
    const segments = file.path.split('/').filter(Boolean);
    let current = root;
    segments.forEach((segment, index) => {
      const isFile = index === segments.length - 1;
      const fullPath = segments.slice(0, index + 1).join('/');
      let child = current.children.find((c) => c.name === segment && c.isFile === isFile);
      if (!child) {
        child = { name: segment, fullPath, isFile, children: [], file: isFile ? file : undefined };
        current.children.push(child);
      }
      current = child;
    });
  }

  sortTree(root);
  return root.children;
}

function sortTree(node: FileTreeNode): void {
  node.children.sort((a, b) => {
    if (a.isFile !== b.isFile) {
      return a.isFile ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) {
    sortTree(child);
  }
}

/** Collapses chains of single-child folders into one node (e.g. "src/app/services"). */
export function collapseSingleChildFolders(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.map((node) => {
    if (node.isFile) {
      return node;
    }
    let current = node;
    let mergedName = current.name;
    while (
      current.children.length === 1 &&
      !current.children[0].isFile &&
      current.children[0].children.length > 0
    ) {
      current = current.children[0];
      mergedName = `${mergedName}/${current.name}`;
    }
    return {
      ...current,
      name: mergedName,
      fullPath: current.fullPath,
      children: collapseSingleChildFolders(current.children),
    };
  });
}
