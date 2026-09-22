import * as GitInterfaces from 'azure-devops-node-api/interfaces/GitInterfaces';
import { PullRequest, PullRequestStatus } from '../models/PullRequest';
import { ChangeType, PullRequestFile } from '../models/PullRequestFile';
import { CommentThreadStatus, PullRequestComment } from '../models/PullRequestComment';

/**
 * Translates raw Azure DevOps REST API objects into normalized internal
 * models. No other module should touch GitInterfaces types directly - this
 * keeps the rest of the extension decoupled from the Azure DevOps SDK
 * (requirement #7: "Do not expose raw Azure DevOps API objects").
 */
export class AzureDevOpsMapper {
  static toPullRequest(pr: GitInterfaces.GitPullRequest, organization: string): PullRequest {
    const repoName = pr.repository?.name ?? '';
    const projectName = pr.repository?.project?.name ?? '';
    const webUrl =
      organization && projectName && repoName && pr.pullRequestId
        ? `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(projectName)}/_git/${encodeURIComponent(repoName)}/pullrequest/${pr.pullRequestId}`
        : '';

    return {
      id: pr.pullRequestId ?? 0,
      title: pr.title ?? '',
      description: pr.description ?? '',
      status: AzureDevOpsMapper.toPullRequestStatus(pr.status, pr.isDraft),
      isDraft: pr.isDraft ?? false,
      sourceBranch: stripRefsHeads(pr.sourceRefName),
      targetBranch: stripRefsHeads(pr.targetRefName),
      repositoryId: pr.repository?.id ?? '',
      repositoryName: repoName,
      projectId: pr.repository?.project?.id ?? '',
      projectName,
      createdBy: pr.createdBy?.displayName ?? 'Unknown',
      creationDate: toIso(pr.creationDate),
      lastUpdateDate: toIso(pr.creationDate),
      url: pr.url ?? '',
      webUrl,
    };
  }

  static toPullRequestStatus(
    status: GitInterfaces.PullRequestStatus | undefined,
    isDraft: boolean | undefined,
  ): PullRequestStatus {
    if (isDraft) {
      return 'draft';
    }
    switch (status) {
      case GitInterfaces.PullRequestStatus.Active:
        return 'active';
      case GitInterfaces.PullRequestStatus.Completed:
        return 'completed';
      case GitInterfaces.PullRequestStatus.Abandoned:
        return 'abandoned';
      default:
        return 'unknown';
    }
  }

  static toChangeType(changeType: GitInterfaces.VersionControlChangeType | undefined): ChangeType {
    if (changeType === undefined) {
      return 'unknown';
    }
    const t = GitInterfaces.VersionControlChangeType;
    if ((changeType & t.Rename) !== 0) {
      return 'rename';
    }
    if ((changeType & t.Add) !== 0) {
      return 'add';
    }
    if ((changeType & t.Delete) !== 0) {
      return 'delete';
    }
    if ((changeType & t.Edit) !== 0) {
      return 'edit';
    }
    return 'unknown';
  }

  static toPullRequestFile(change: GitInterfaces.GitPullRequestChange): PullRequestFile {
    const path = change.item?.path ?? change.originalPath ?? '';
    return {
      path: normalizePath(path),
      changeType: AzureDevOpsMapper.toChangeType(change.changeType),
      additions: 0,
      deletions: 0,
      originalPath: change.originalPath ? normalizePath(change.originalPath) : undefined,
      objectId: change.item?.objectId,
      originalObjectId: change.item?.originalObjectId,
    };
  }

  static toCommentThreadStatus(
    status: GitInterfaces.CommentThreadStatus | undefined,
  ): CommentThreadStatus {
    switch (status) {
      case GitInterfaces.CommentThreadStatus.Active:
        return 'active';
      case GitInterfaces.CommentThreadStatus.Fixed:
        return 'fixed';
      case GitInterfaces.CommentThreadStatus.WontFix:
        return 'wontFix';
      case GitInterfaces.CommentThreadStatus.Closed:
        return 'closed';
      case GitInterfaces.CommentThreadStatus.ByDesign:
        return 'byDesign';
      case GitInterfaces.CommentThreadStatus.Pending:
        return 'pending';
      default:
        return 'unknown';
    }
  }

  /** Flattens each comment in a thread into a PullRequestComment, one per comment. */
  static toPullRequestComments(
    thread: GitInterfaces.GitPullRequestCommentThread,
  ): PullRequestComment[] {
    const filePath = thread.threadContext?.filePath
      ? normalizePath(thread.threadContext.filePath)
      : undefined;
    const status = AzureDevOpsMapper.toCommentThreadStatus(thread.status);
    const startLine =
      thread.threadContext?.rightFileStart?.line ?? thread.threadContext?.leftFileStart?.line;
    const endLine =
      thread.threadContext?.rightFileEnd?.line ?? thread.threadContext?.leftFileEnd?.line;

    return (thread.comments ?? [])
      .filter((c) => !c.isDeleted)
      .map((c) => ({
        id: c.id ?? 0,
        threadId: thread.id ?? 0,
        author: c.author?.displayName ?? 'Unknown',
        content: c.content ?? '',
        status,
        filePath,
        startLine,
        endLine,
        threadContext: thread.threadContext
          ? {
              filePath: filePath ?? '',
              rightFileStartLine: thread.threadContext.rightFileStart?.line,
              rightFileEndLine: thread.threadContext.rightFileEnd?.line,
              leftFileStartLine: thread.threadContext.leftFileStart?.line,
              leftFileEndLine: thread.threadContext.leftFileEnd?.line,
            }
          : undefined,
        publishedDate: toIso(c.publishedDate),
        isDeleted: c.isDeleted,
      }));
  }
}

function stripRefsHeads(ref: string | undefined): string {
  return ref?.replace(/^refs\/heads\//, '') ?? '';
}

function toIso(date: Date | string | undefined): string {
  if (!date) {
    return '';
  }
  return date instanceof Date ? date.toISOString() : new Date(date).toISOString();
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path.slice(1) : path;
}
