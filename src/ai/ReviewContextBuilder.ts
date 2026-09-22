import * as vscode from 'vscode';
import { PullRequest } from '../models/PullRequest';
import { PullRequestFile } from '../models/PullRequestFile';
import { PullRequestDiffService } from '../azure/PullRequestDiffService';
import { PullRequestCommentService } from '../azure/PullRequestCommentService';
import { ReviewContext, ReviewFile } from './AIReviewProvider';
import { throwIfCancelled } from '../utils/cancellation';

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  java: 'java',
  cs: 'csharp',
  go: 'go',
  rb: 'ruby',
  rs: 'rust',
  php: 'php',
  cpp: 'cpp',
  c: 'c',
  h: 'c',
  hpp: 'cpp',
  dart: 'dart',
  kt: 'kotlin',
  swift: 'swift',
  sql: 'sql',
  sh: 'shellscript',
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
  md: 'markdown',
};

/** Builds the normalized ReviewContext AI providers receive (requirement #17). */
export class ReviewContextBuilder {
  constructor(
    private readonly diffService: PullRequestDiffService,
    private readonly commentService: PullRequestCommentService,
  ) {}

  async build(
    pullRequest: PullRequest,
    files: PullRequestFile[],
    cancellationToken?: vscode.CancellationToken,
  ): Promise<ReviewContext> {
    const existingComments = await this.commentService.getThreads(pullRequest.id);
    throwIfCancelled(cancellationToken);

    const reviewFiles: ReviewFile[] = [];
    for (const file of files) {
      throwIfCancelled(cancellationToken);
      const diff = await this.diffService.getFileDiff(pullRequest.id, file);
      reviewFiles.push({
        path: diff.path,
        language: detectLanguage(diff.path),
        oldContent: diff.oldContent,
        newContent: diff.newContent,
        diff: diff.patch ?? '',
        additions: diff.additions,
        deletions: diff.deletions,
      });
    }

    return {
      pullRequest,
      files: reviewFiles,
      existingComments,
      repositoryContext: {
        repositoryName: pullRequest.repositoryName,
        projectName: pullRequest.projectName,
      },
    };
  }
}

export function detectLanguage(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase();
  return ext ? LANGUAGE_BY_EXTENSION[ext] : undefined;
}
