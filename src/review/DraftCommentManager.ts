import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { StateStore } from '../storage/StateStore';
import { DraftComment } from '../models/DraftComment';
import { NewThreadRequest } from '../azure/AzureDevOpsClient';

/**
 * Owns draft (unpublished) human review comments for the current session. Nothing here ever
 * calls Azure DevOps - only `publishDraftComments.ts` does, and only on an explicit user command.
 */
export class DraftCommentManager {
  private readonly emitter = new vscode.EventEmitter<number>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly store: StateStore) {}

  list(pullRequestId: number): DraftComment[] {
    return this.store.getDraftComments(pullRequestId);
  }

  async add(pullRequestId: number, request: NewThreadRequest): Promise<DraftComment> {
    const draft: DraftComment = {
      id: crypto.randomUUID(),
      pullRequestId,
      filePath: request.filePath,
      content: request.content,
      rightFileStartLine: request.rightFileStartLine,
      rightFileEndLine: request.rightFileEndLine,
      leftFileStartLine: request.leftFileStartLine,
      leftFileEndLine: request.leftFileEndLine,
      createdAt: new Date().toISOString(),
    };
    await this.store.saveDraftComments(pullRequestId, [...this.list(pullRequestId), draft]);
    this.emitter.fire(pullRequestId);
    return draft;
  }

  async edit(pullRequestId: number, draftId: string, content: string): Promise<void> {
    const drafts = this.list(pullRequestId).map((d) => (d.id === draftId ? { ...d, content } : d));
    await this.store.saveDraftComments(pullRequestId, drafts);
    this.emitter.fire(pullRequestId);
  }

  async remove(pullRequestId: number, draftId: string): Promise<void> {
    const drafts = this.list(pullRequestId).filter((d) => d.id !== draftId);
    await this.store.saveDraftComments(pullRequestId, drafts);
    this.emitter.fire(pullRequestId);
  }

  async clearAll(pullRequestId: number): Promise<void> {
    await this.store.clearDraftComments(pullRequestId);
    this.emitter.fire(pullRequestId);
  }

  /** Replaces the full draft list for a PR (used after a publish pass to keep only the failures). */
  async replaceAll(pullRequestId: number, drafts: DraftComment[]): Promise<void> {
    await this.store.saveDraftComments(pullRequestId, drafts);
    this.emitter.fire(pullRequestId);
  }
}
