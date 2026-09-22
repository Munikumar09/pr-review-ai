import { describe, expect, it } from 'vitest';
import { buildFileTree } from '../../diff/DiffTreeProvider';
import { PullRequestFile } from '../../models/PullRequestFile';

function file(path: string, changeType: PullRequestFile['changeType'] = 'edit'): PullRequestFile {
  return { path, changeType, additions: 1, deletions: 0 };
}

describe('buildFileTree', () => {
  it('groups files under shared folders', () => {
    const tree = buildFileTree([
      file('backend/app/services/payment.py'),
      file('backend/app/services/retry.py'),
      file('backend/app/schemas.py'),
      file('frontend/payment_screen.dart'),
    ]);

    const backend = tree.find((n) => n.name === 'backend');
    expect(backend).toBeDefined();
    expect(backend!.isFile).toBe(false);

    const app = backend!.children.find((n) => n.name === 'app');
    expect(app!.children.map((c) => c.name).sort()).toEqual(['schemas.py', 'services']);

    const services = app!.children.find((n) => n.name === 'services');
    expect(services!.children).toHaveLength(2);
    expect(services!.children.every((c) => c.isFile)).toBe(true);

    const frontend = tree.find((n) => n.name === 'frontend');
    expect(frontend!.children[0].isFile).toBe(true);
  });

  it('sorts folders before files, alphabetically within each group', () => {
    const tree = buildFileTree([file('z.ts'), file('a-folder/nested.ts'), file('a.ts')]);
    expect(tree.map((n) => n.name)).toEqual(['a-folder', 'a.ts', 'z.ts']);
  });

  it('handles an empty file list', () => {
    expect(buildFileTree([])).toEqual([]);
  });

  it('attaches the original PullRequestFile to file nodes', () => {
    const f = file('app.ts');
    const tree = buildFileTree([f]);
    expect(tree[0].file).toBe(f);
  });

  it('attaches the original PullRequestFile to nested file nodes', () => {
    const f = file('src/app.ts');
    const tree = buildFileTree([f]);
    expect(tree[0].children[0].file).toBe(f);
  });
});
