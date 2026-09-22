import * as vscode from 'vscode';
import { ReviewSession } from '../models/ReviewSession';
import { StateStore } from '../storage/StateStore';

/**
 * In-memory reactive store of active/completed review sessions, backed by
 * StateStore for persistence across window reloads (requirement #31). Tree
 * views subscribe to `onDidChange` to refresh.
 */
export class ReviewState {
  private readonly sessions = new Map<number, ReviewSession>();
  private readonly emitter = new vscode.EventEmitter<number>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly store: StateStore) {
    for (const session of store.getReviewSessions()) {
      this.sessions.set(session.pullRequestId, session);
    }
  }

  get(pullRequestId: number): ReviewSession | undefined {
    return this.sessions.get(pullRequestId);
  }

  async set(session: ReviewSession): Promise<void> {
    this.sessions.set(session.pullRequestId, session);
    await this.store.saveReviewSession(session);
    this.emitter.fire(session.pullRequestId);
  }

  async clear(pullRequestId: number): Promise<void> {
    this.sessions.delete(pullRequestId);
    await this.store.clearReviewSession(pullRequestId);
    this.emitter.fire(pullRequestId);
  }

  notify(pullRequestId: number): void {
    this.emitter.fire(pullRequestId);
  }
}
