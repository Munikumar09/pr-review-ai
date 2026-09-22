import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { DraftCommentManager } from '../../review/DraftCommentManager';
import { StateStore } from '../../storage/StateStore';

function makeStore(): StateStore {
  const memory = new Map<string, unknown>();
  const fakeContext = {
    workspaceState: {
      get: <T>(key: string, defaultValue: T) =>
        memory.has(key) ? (memory.get(key) as T) : defaultValue,
      update: (key: string, value: unknown) => {
        memory.set(key, value);
        return Promise.resolve();
      },
    },
  };
  return new StateStore(fakeContext as unknown as vscode.ExtensionContext);
}

describe('DraftCommentManager', () => {
  it('adds a draft and lists it back for the same pull request', async () => {
    const manager = new DraftCommentManager(makeStore());

    const draft = await manager.add(1, {
      content: 'Looks off',
      filePath: 'a.ts',
      rightFileStartLine: 5,
    });

    expect(manager.list(1)).toHaveLength(1);
    expect(manager.list(1)[0]).toMatchObject({
      id: draft.id,
      content: 'Looks off',
      filePath: 'a.ts',
      rightFileStartLine: 5,
    });
  });

  it('scopes drafts per pull request', async () => {
    const manager = new DraftCommentManager(makeStore());
    await manager.add(1, { content: 'For PR 1', filePath: 'a.ts' });
    await manager.add(2, { content: 'For PR 2', filePath: 'b.ts' });

    expect(manager.list(1)).toHaveLength(1);
    expect(manager.list(2)).toHaveLength(1);
    expect(manager.list(1)[0].content).toBe('For PR 1');
  });

  it('edit updates only the targeted draft', async () => {
    const manager = new DraftCommentManager(makeStore());
    const a = await manager.add(1, { content: 'first', filePath: 'a.ts' });
    const b = await manager.add(1, { content: 'second', filePath: 'b.ts' });

    await manager.edit(1, a.id, 'first (edited)');

    const drafts = manager.list(1);
    expect(drafts.find((d) => d.id === a.id)?.content).toBe('first (edited)');
    expect(drafts.find((d) => d.id === b.id)?.content).toBe('second');
  });

  it('remove deletes only the targeted draft', async () => {
    const manager = new DraftCommentManager(makeStore());
    const a = await manager.add(1, { content: 'first', filePath: 'a.ts' });
    const b = await manager.add(1, { content: 'second', filePath: 'b.ts' });

    await manager.remove(1, a.id);

    expect(manager.list(1)).toEqual([b]);
  });

  it('clearAll removes every draft for that pull request only', async () => {
    const manager = new DraftCommentManager(makeStore());
    await manager.add(1, { content: 'for PR 1', filePath: 'a.ts' });
    await manager.add(2, { content: 'for PR 2', filePath: 'b.ts' });

    await manager.clearAll(1);

    expect(manager.list(1)).toEqual([]);
    expect(manager.list(2)).toHaveLength(1);
  });

  it('replaceAll overwrites the full list for a pull request', async () => {
    const manager = new DraftCommentManager(makeStore());
    const kept = await manager.add(1, { content: 'kept', filePath: 'a.ts' });
    await manager.add(1, { content: 'dropped', filePath: 'b.ts' });

    await manager.replaceAll(1, [kept]);

    expect(manager.list(1)).toEqual([kept]);
  });

  it('fires onDidChange for the affected pull request on every mutation', async () => {
    const manager = new DraftCommentManager(makeStore());
    const listener = vi.fn();
    manager.onDidChange(listener);

    const draft = await manager.add(1, { content: 'x', filePath: 'a.ts' });
    await manager.edit(1, draft.id, 'y');
    await manager.remove(1, draft.id);

    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenCalledWith(1);
  });
});
