import * as vscode from 'vscode';
import { createHash } from 'crypto';
import { ReviewSession } from '../models/ReviewSession';
import { DraftComment } from '../models/DraftComment';

const REVIEW_SESSIONS_KEY = 'azurePrReview.reviewSessions';
const DRAFT_COMMENTS_KEY = 'azurePrReview.draftComments';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Lightweight persistence layer.
 *
 * - Review session metadata (findings, status) is persisted to
 *   workspaceState so an in-progress review survives a window reload.
 * - PR/file/thread data is cached in-memory only (see #35: "do not build a
 *   complex database", "use in-memory caching initially"). We deliberately
 *   avoid persisting full source code / diffs to disk.
 */
export class StateStore {
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  private readonly scope: string;

  constructor(
    private readonly context: vscode.ExtensionContext,
    connectionScope = 'unconfigured',
  ) {
    this.scope = scopeHash(connectionScope);
  }

  private key(base: string, scope = this.scope): string {
    // Legacy unscoped entries cannot safely be attributed to a repository.
    return `${base}:${scope}`;
  }

  /**
   * Moves reviews/drafts saved under older, narrower scopes into this one - e.g. the
   * single-repository connection identities used before several repositories could be
   * configured. Callers pass only scopes known to belong to this scope, so the entries'
   * ownership is not guessed. Existing entries win per PR, and the old keys are removed so a
   * review cleared afterwards can't reappear on the next activation.
   */
  async adoptLegacyScopes(legacyScopes: string[]): Promise<void> {
    const state = this.context.workspaceState;
    for (const legacy of legacyScopes) {
      const scope = scopeHash(legacy);
      if (scope === this.scope) {
        continue;
      }
      const sessions = state.get<ReviewSession[]>(this.key(REVIEW_SESSIONS_KEY, scope), []);
      if (sessions.length > 0) {
        const current = this.getReviewSessions();
        const known = new Set(current.map((s) => s.pullRequestId));
        const adopted = sessions.filter((s) => !known.has(s.pullRequestId));
        await state.update(this.key(REVIEW_SESSIONS_KEY), [...current, ...adopted]);
      }
      const drafts = state.get<DraftComment[]>(this.key(DRAFT_COMMENTS_KEY, scope), []);
      if (drafts.length > 0) {
        const current = this.getAllDraftComments();
        const known = new Set(current.map((d) => d.pullRequestId));
        const adopted = drafts.filter((d) => !known.has(d.pullRequestId));
        await state.update(this.key(DRAFT_COMMENTS_KEY), [...current, ...adopted]);
      }
      await state.update(this.key(REVIEW_SESSIONS_KEY, scope), undefined);
      await state.update(this.key(DRAFT_COMMENTS_KEY, scope), undefined);
    }
  }

  getCached<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  setCached<T>(key: string, value: T, ttlMs = 60_000): void {
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  invalidate(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  getReviewSessions(): ReviewSession[] {
    return this.context.workspaceState.get<ReviewSession[]>(this.key(REVIEW_SESSIONS_KEY), []);
  }

  getReviewSession(pullRequestId: number): ReviewSession | undefined {
    return this.getReviewSessions().find((s) => s.pullRequestId === pullRequestId);
  }

  async saveReviewSession(session: ReviewSession): Promise<void> {
    const sessions = this.getReviewSessions().filter(
      (s) => s.pullRequestId !== session.pullRequestId,
    );
    sessions.push(session);
    await this.context.workspaceState.update(this.key(REVIEW_SESSIONS_KEY), sessions);
  }

  async clearReviewSession(pullRequestId: number): Promise<void> {
    const sessions = this.getReviewSessions().filter((s) => s.pullRequestId !== pullRequestId);
    await this.context.workspaceState.update(this.key(REVIEW_SESSIONS_KEY), sessions);
  }

  /** Draft (unpublished) human review comments, persisted so they survive a window reload. */
  getDraftComments(pullRequestId: number): DraftComment[] {
    return this.getAllDraftComments().filter((d) => d.pullRequestId === pullRequestId);
  }

  async saveDraftComments(pullRequestId: number, drafts: DraftComment[]): Promise<void> {
    const others = this.getAllDraftComments().filter((d) => d.pullRequestId !== pullRequestId);
    await this.context.workspaceState.update(this.key(DRAFT_COMMENTS_KEY), [...others, ...drafts]);
  }

  async clearDraftComments(pullRequestId: number): Promise<void> {
    const others = this.getAllDraftComments().filter((d) => d.pullRequestId !== pullRequestId);
    await this.context.workspaceState.update(this.key(DRAFT_COMMENTS_KEY), others);
  }

  private getAllDraftComments(): DraftComment[] {
    return this.context.workspaceState.get<DraftComment[]>(this.key(DRAFT_COMMENTS_KEY), []);
  }
}

function scopeHash(scope: string): string {
  return createHash('sha256').update(scope).digest('hex');
}
