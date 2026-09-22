import * as vscode from 'vscode';
import { PullRequestCommentService } from '../azure/PullRequestCommentService';
import { DraftCommentManager } from '../review/DraftCommentManager';
import { PullRequestFile } from '../models/PullRequestFile';
import { PullRequest } from '../models/PullRequest';
import { parseDiffUri } from '../diff/DiffContentProvider';
import { toUserMessage } from '../utils/errors';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

/**
 * Context-menu entry point (requirement #11/#14): "Add Comment" on a changed file, prompting for
 * a line and comment text. Saved as a local draft, not published - use "Publish All Draft
 * Comments" when the whole review is done (mirrors the AI findings' approve-then-publish gate).
 */
export async function addCommentFromContextMenu(
  draftManager: DraftCommentManager,
  pullRequest: PullRequest,
  file: PullRequestFile,
): Promise<void> {
  const lineInput = await vscode.window.showInputBox({
    title: `Add Review Comment — ${file.path}`,
    prompt: 'Line number to comment on',
    validateInput: (value) =>
      Number.isInteger(Number(value)) && Number(value) > 0
        ? undefined
        : 'Enter a valid line number.',
  });
  if (!lineInput) {
    return;
  }
  const content = await vscode.window.showInputBox({
    title: `Add Review Comment — ${file.path}:${lineInput}`,
    prompt: 'Comment',
    placeHolder: 'Leave a review comment...',
    validateInput: (value) => (value.trim().length === 0 ? 'Comment cannot be empty.' : undefined),
  });
  if (!content) {
    return;
  }

  const line = Number(lineInput);
  try {
    await draftManager.add(pullRequest.id, {
      content,
      filePath: file.path,
      rightFileStartLine: file.changeType === 'delete' ? undefined : line,
      rightFileEndLine: file.changeType === 'delete' ? undefined : line,
      leftFileStartLine: file.changeType === 'delete' ? line : undefined,
      leftFileEndLine: file.changeType === 'delete' ? line : undefined,
    });
    vscode.window.showInformationMessage(
      `Saved as a draft comment on ${file.path}:${line}. Use "Publish All Draft Comments" when you're done reviewing.`,
    );
  } catch (err) {
    logger.error('Failed to save draft comment.', err);
    vscode.window.showErrorMessage(toUserMessage(err));
  }
}

/** A native comment thread that already corresponds to a real, published Azure DevOps thread. */
const threadIdByLocalThread = new WeakMap<vscode.CommentThread, number>();
/** A native comment thread whose first comment is still an unpublished local draft. */
const draftIdByLocalThread = new WeakMap<vscode.CommentThread, string>();

/**
 * Handles a reply submitted through VS Code's native Comments UI (the "+" gutter affordance on a
 * diff document) - requirement #14's "Comment editor -> Publish" step, using the native editor
 * instead of a custom widget.
 *
 * A reply that starts a *new* thread is saved as a draft, not published, so a whole review can be
 * written before anything reaches Azure DevOps. A reply added to a thread that's already real
 * (loaded from Azure DevOps, or already published from an earlier draft) is a live conversation
 * reply and is still published immediately, same as before.
 */
export async function handleNativeCommentReply(
  draftManager: DraftCommentManager,
  commentService: Pick<PullRequestCommentService, 'reply'>,
  reply: vscode.CommentReply,
): Promise<void> {
  const thread = reply.thread;
  const parsed = parseDiffUri(thread.uri);
  if (!parsed) {
    vscode.window.showErrorMessage(
      'Comments can only be added on an Azure PR Review diff document.',
    );
    return;
  }

  // thread.range spans every line the user selected in the gutter before replying (a multi-line
  // comment) - both ends must be forwarded, not just the start, or the range collapses to 1 line.
  const startLine = (thread.range?.start.line ?? 0) + 1;
  const endLine = (thread.range?.end.line ?? thread.range?.start.line ?? 0) + 1;

  try {
    const existingRealThreadId = threadIdByLocalThread.get(thread);
    if (existingRealThreadId) {
      // Continuing an already-published, real conversation - not part of "my draft review".
      await commentService.reply(parsed.pullRequestId, existingRealThreadId, reply.text);
      thread.comments = [
        ...thread.comments,
        {
          body: new vscode.MarkdownString(reply.text),
          mode: vscode.CommentMode.Preview,
          author: { name: 'You' },
        },
      ];
      thread.label = 'Published to Azure DevOps';
      return;
    }

    const existingDraftId = draftIdByLocalThread.get(thread);
    if (existingDraftId) {
      // A second reply on the same not-yet-published thread - fold it into the same draft.
      const existing = draftManager
        .list(parsed.pullRequestId)
        .find((d) => d.id === existingDraftId);
      const combined = existing ? `${existing.content}\n\n${reply.text}` : reply.text;
      await draftManager.edit(parsed.pullRequestId, existingDraftId, combined);
    } else {
      const draft = await draftManager.add(parsed.pullRequestId, {
        content: reply.text,
        filePath: parsed.filePath,
        rightFileStartLine: parsed.side === 'new' ? startLine : undefined,
        rightFileEndLine: parsed.side === 'new' ? endLine : undefined,
        leftFileStartLine: parsed.side === 'old' ? startLine : undefined,
        leftFileEndLine: parsed.side === 'old' ? endLine : undefined,
      });
      draftIdByLocalThread.set(thread, draft.id);
    }
    thread.comments = [
      ...thread.comments,
      {
        body: new vscode.MarkdownString(reply.text),
        mode: vscode.CommentMode.Preview,
        author: { name: 'You (draft)' },
      },
    ];
    thread.label = 'Draft - not yet published to Azure DevOps';
  } catch (err) {
    logger.error('Failed to save draft comment.', err);
    vscode.window.showErrorMessage(toUserMessage(err));
  }
}
