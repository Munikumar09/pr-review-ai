import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { CopilotProvider } from '../../ai/providers/CopilotProvider';
import { ReviewPromptBuilder } from '../../ai/ReviewPromptBuilder';
import { ReviewContext, ReviewOptions } from '../../ai/AIReviewProvider';
import { PullRequest } from '../../models/PullRequest';

const repoRoot = process.cwd();

function pullRequest(): PullRequest {
  return {
    id: 1,
    title: 'Add feature',
    description: '',
    status: 'active',
    isDraft: false,
    sourceBranch: 'feature/x',
    targetBranch: 'main',
    repositoryId: 'r1',
    repositoryName: 'repo',
    projectId: 'p1',
    projectName: 'proj',
    createdBy: 'dev',
    creationDate: '',
    lastUpdateDate: '',
    url: '',
    webUrl: '',
  };
}

function context(): ReviewContext {
  return {
    pullRequest: pullRequest(),
    files: [
      {
        path: 'a.ts',
        language: 'typescript',
        oldContent: 'a',
        newContent: 'b',
        diff: '@@ -1 +1 @@\n-a\n+b',
        additions: 1,
        deletions: 1,
      },
    ],
    existingComments: [],
  };
}

function options(): ReviewOptions {
  return { mode: 'full', maxFindings: 20, minConfidence: 0.75, categories: ['bug'] };
}

/** Minimal fake satisfying the subset of vscode.LanguageModelChat this provider touches. */
function fakeModel(id: string, family: string, name: string) {
  const sendRequest = vi.fn(async () => ({
    text: (async function* () {
      yield '{"findings": []}';
    })(),
  }));
  return {
    model: { id, family, name, sendRequest } as unknown as vscode.LanguageModelChat,
    sendRequest,
  };
}

describe('CopilotProvider model selection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the first available model when no model is configured', async () => {
    const a = fakeModel('a-id', 'gpt-4o', 'GPT-4o');
    const b = fakeModel('b-id', 'o1', 'o1');
    vi.spyOn(vscode.lm, 'selectChatModels').mockResolvedValue([a.model, b.model]);

    const provider = new CopilotProvider(() => '', new ReviewPromptBuilder(repoRoot));
    await provider.review(context(), options());

    expect(a.sendRequest).toHaveBeenCalledTimes(1);
    expect(b.sendRequest).not.toHaveBeenCalled();
  });

  it('uses the configured model when it matches an available model id', async () => {
    const a = fakeModel('a-id', 'gpt-4o', 'GPT-4o');
    const b = fakeModel('b-id', 'claude-3.5-sonnet', 'Claude 3.5 Sonnet');
    vi.spyOn(vscode.lm, 'selectChatModels').mockResolvedValue([a.model, b.model]);

    const provider = new CopilotProvider(() => 'b-id', new ReviewPromptBuilder(repoRoot));
    await provider.review(context(), options());

    expect(b.sendRequest).toHaveBeenCalledTimes(1);
    expect(a.sendRequest).not.toHaveBeenCalled();
  });

  it('uses the configured model when it matches by family, not just id', async () => {
    const a = fakeModel('a-id', 'gpt-4o', 'GPT-4o');
    const b = fakeModel('b-id', 'claude-3.5-sonnet', 'Claude 3.5 Sonnet');
    vi.spyOn(vscode.lm, 'selectChatModels').mockResolvedValue([a.model, b.model]);

    const provider = new CopilotProvider(
      () => 'claude-3.5-sonnet',
      new ReviewPromptBuilder(repoRoot),
    );
    await provider.review(context(), options());

    expect(b.sendRequest).toHaveBeenCalledTimes(1);
    expect(a.sendRequest).not.toHaveBeenCalled();
  });

  it('falls back to the first model when the configured one is not available', async () => {
    const a = fakeModel('a-id', 'gpt-4o', 'GPT-4o');
    vi.spyOn(vscode.lm, 'selectChatModels').mockResolvedValue([a.model]);

    const provider = new CopilotProvider(() => 'does-not-exist', new ReviewPromptBuilder(repoRoot));
    await provider.review(context(), options());

    expect(a.sendRequest).toHaveBeenCalledTimes(1);
  });
});
