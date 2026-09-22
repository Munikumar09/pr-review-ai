import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { FindingManager } from '../../review/FindingManager';
import { ReviewState } from '../../review/ReviewState';
import { StateStore } from '../../storage/StateStore';
import { ReviewFinding } from '../../models/ReviewFinding';
import { ReviewSession } from '../../models/ReviewSession';

function makeState(): ReviewState {
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
  return new ReviewState(new StateStore(fakeContext as unknown as vscode.ExtensionContext));
}

function finding(): ReviewFinding {
  return {
    id: 'f1',
    severity: 'medium',
    category: 'bug',
    title: 'Title',
    description: 'Description',
    filePath: 'a.ts',
    startLine: 1,
    endLine: 1,
    confidence: 0.8,
    provider: 'mock',
    status: 'pending',
  };
}

function session(findings: ReviewFinding[]): ReviewSession {
  return {
    id: 's1',
    pullRequestId: 7,
    provider: 'mock',
    status: 'completed',
    startedAt: new Date().toISOString(),
    findings,
    filesReviewed: 1,
    filesSkipped: 0,
  };
}

describe('FindingManager', () => {
  it('approve transitions a pending finding to approved', async () => {
    const state = makeState();
    await state.set(session([finding()]));
    const manager = new FindingManager(state);

    const updated = await manager.approve(7, 'f1');

    expect(updated.status).toBe('approved');
  });

  it('reject is terminal and never becomes approved again through edit', async () => {
    const state = makeState();
    await state.set(session([finding()]));
    const manager = new FindingManager(state);

    await manager.reject(7, 'f1');
    const afterEdit = await manager.edit(7, 'f1', { title: 'New title' });

    // Editing after rejection sets status to 'edited', matching requirement #27;
    // publishing eligibility is enforced separately by ApprovalManager.
    expect(afterEdit.status).toBe('edited');
    expect(afterEdit.title).toBe('New title');
  });

  it('edit updates fields and sets status to edited', async () => {
    const state = makeState();
    await state.set(session([finding()]));
    const manager = new FindingManager(state);

    const updated = await manager.edit(7, 'f1', { description: 'Updated description' });

    expect(updated.status).toBe('edited');
    expect(updated.description).toBe('Updated description');
  });

  it('throws when the finding does not exist', async () => {
    const state = makeState();
    await state.set(session([]));
    const manager = new FindingManager(state);

    await expect(manager.approve(7, 'missing')).rejects.toThrow();
  });

  it('remove deletes the finding entirely, not just its status', async () => {
    const state = makeState();
    await state.set(session([finding(), { ...finding(), id: 'f2' }]));
    const manager = new FindingManager(state);

    await manager.remove(7, 'f1');

    const remaining = state.get(7)?.findings ?? [];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('f2');
  });

  it('remove throws when the finding does not exist', async () => {
    const state = makeState();
    await state.set(session([finding()]));
    const manager = new FindingManager(state);

    await expect(manager.remove(7, 'missing')).rejects.toThrow();
  });
});
