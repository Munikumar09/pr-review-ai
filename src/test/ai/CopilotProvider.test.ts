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

describe('Copilot outbound secret gate', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['removed diff', 'PR metadata', 'comment', 'custom instructions'])(
    'blocks a secret in %s before sendRequest',
    async (location) => {
      const secret = 'AKIAABCDEFGHIJKLMNOP';
      const review = context();
      const opts = options();
      if (location === 'removed diff') review.files[0].diff = `@@ -1 +1 @@\n-${secret}\n+removed`;
      if (location === 'PR metadata') review.pullRequest.description = secret;
      if (location === 'comment')
        review.existingComments = [
          {
            id: 1,
            threadId: 1,
            author: 'dev',
            content: secret,
            status: 'active',
            publishedDate: '',
          },
        ];
      if (location === 'custom instructions') opts.customInstructions = secret;
      const model = fakeModel('a', 'a', 'a');
      vi.spyOn(vscode.lm, 'selectChatModels').mockResolvedValue([model.model]);
      const warning = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);
      const provider = new CopilotProvider(() => '', new ReviewPromptBuilder(repoRoot));
      await expect(provider.review(review, opts)).rejects.toThrow('cancelled');
      expect(warning).toHaveBeenCalledOnce();
      expect(JSON.stringify(warning.mock.calls)).not.toContain(secret);
      expect(model.sendRequest).not.toHaveBeenCalled();
    },
  );

  it('sends the exact inspected prompt after explicit consent', async () => {
    const review = context();
    review.pullRequest.title = 'AKIAABCDEFGHIJKLMNOP';
    const model = fakeModel('a', 'a', 'a');
    vi.spyOn(vscode.lm, 'selectChatModels').mockResolvedValue([model.model]);
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Send to AI Provider' as never);
    const builder = new ReviewPromptBuilder(repoRoot);
    await new CopilotProvider(() => '', builder).review(review, options());
    expect(model.sendRequest).toHaveBeenCalledWith(
      [vscode.LanguageModelChatMessage.User(builder.build(review, options()))],
      {},
      undefined,
    );
  });

  it('rejects an oversized response', async () => {
    const model = fakeModel('a', 'a', 'a');
    model.sendRequest.mockResolvedValue({
      text: (async function* () {
        yield 'x'.repeat(2 * 1024 * 1024 + 1);
      })(),
    });
    vi.spyOn(vscode.lm, 'selectChatModels').mockResolvedValue([model.model]);
    await expect(
      new CopilotProvider(() => '', new ReviewPromptBuilder(repoRoot)).review(context(), options()),
    ).rejects.toThrow('size limit');
  });
});
