import * as vscode from 'vscode';
import { existsSync } from 'fs';
import { SpawnOptions } from 'child_process';
import { MAX_AI_RESPONSE_BYTES } from '../../utils/securityLimits';
import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'child_process';
import { OpenCodeProvider } from '../../ai/providers/OpenCodeProvider';
import { ReviewPromptBuilder } from '../../ai/ReviewPromptBuilder';
import { ReviewContext, ReviewOptions } from '../../ai/AIReviewProvider';
import { PullRequest } from '../../models/PullRequest';

vi.mock('child_process', () => ({ spawn: vi.fn() }));

const repoRoot = process.cwd();
const mockedSpawn = vi.mocked(spawn);

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

/** A fake ChildProcess that immediately succeeds with the given stdout once stdin is closed. */
function fakeChild(stdout: string) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: EventEmitter & { write: (d: unknown) => void; end: () => void };
    kill: () => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const stdin = new EventEmitter() as EventEmitter & {
    write: (d: unknown) => void;
    end: () => void;
  };
  stdin.write = vi.fn();
  stdin.end = vi.fn(() => {
    queueMicrotask(() => {
      if (stdout) {
        child.stdout.emit('data', Buffer.from(stdout));
      }
      child.emit('close', 0);
    });
  });
  child.stdin = stdin;
  child.kill = vi.fn();
  return child;
}

function ndjsonText(text: string): string {
  return `${JSON.stringify({ type: 'text', part: { text } })}\n`;
}

describe('OpenCodeProvider model configuration', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not pass --model when no model is configured', async () => {
    mockedSpawn.mockImplementation(() => fakeChild(ndjsonText('{"findings": []}')) as never);

    const provider = new OpenCodeProvider(
      () => 'opencode',
      () => '',
      new ReviewPromptBuilder(repoRoot),
    );
    await provider.review(context(), options());

    const runCall = mockedSpawn.mock.calls.find((c) => (c[1] as string[])?.[0] === 'run');
    expect(runCall?.[1]).toEqual([
      'run',
      '--format',
      'json',
      '--pure',
      '--agent',
      expect.stringMatching(/^azure-pr-review-/),
    ]);
  });

  it('passes --model <configured model> when one is configured', async () => {
    mockedSpawn.mockImplementation(() => fakeChild(ndjsonText('{"findings": []}')) as never);

    const provider = new OpenCodeProvider(
      () => 'opencode',
      () => 'anthropic/claude-sonnet-4-5',
      new ReviewPromptBuilder(repoRoot),
    );
    await provider.review(context(), options());

    const runCall = mockedSpawn.mock.calls.find((c) => (c[1] as string[])?.[0] === 'run');
    expect(runCall?.[1]).toEqual([
      'run',
      '--format',
      'json',
      '--pure',
      '--agent',
      expect.stringMatching(/^azure-pr-review-/),
      '--model',
      'anthropic/claude-sonnet-4-5',
    ]);
  });

  it('uses the live command getter to spawn the CLI', async () => {
    mockedSpawn.mockImplementation(() => fakeChild(ndjsonText('{"findings": []}')) as never);

    let command = 'opencode-v1';
    const provider = new OpenCodeProvider(
      () => command,
      () => '',
      new ReviewPromptBuilder(repoRoot),
    );
    await provider.review(context(), options());
    expect(mockedSpawn.mock.calls[0][0]).toBe('opencode-v1');

    command = 'opencode-v2';
    mockedSpawn.mockClear();
    await provider.review(context(), options());
    expect(mockedSpawn.mock.calls[0][0]).toBe('opencode-v2');
  });

  it('listModels parses newline-separated "provider/model" output', async () => {
    mockedSpawn.mockImplementation(
      () => fakeChild('opencode/big-pickle\nanthropic/claude-sonnet-4-5\n\n') as never,
    );

    const provider = new OpenCodeProvider(
      () => 'opencode',
      () => '',
      new ReviewPromptBuilder(repoRoot),
    );
    const models = await provider.listModels();

    expect(models).toEqual(['opencode/big-pickle', 'anthropic/claude-sonnet-4-5']);
    expect(mockedSpawn.mock.calls[0][1]).toEqual(['models', '--pure']);
  });

  it('listModels returns an empty array (not a throw) if the CLI fails', async () => {
    mockedSpawn.mockImplementation(() => {
      const child = fakeChild('');
      child.stdin.end = vi.fn(() => {
        queueMicrotask(() => child.emit('close', 1));
      });
      return child as never;
    });

    const provider = new OpenCodeProvider(
      () => 'opencode',
      () => '',
      new ReviewPromptBuilder(repoRoot),
    );
    await expect(provider.listModels()).resolves.toEqual([]);
  });
});

describe('OpenCode security boundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    Object.assign(vscode.workspace, { isTrusted: true });
  });

  it('denies all tools, disables sharing, ignores inherited overrides and cleans every scratch directory', async () => {
    vi.stubEnv('OPENCODE_PERMISSION', '{"*":"allow"}');
    vi.stubEnv('OPENCODE_CONFIG', '/workspace/attacker.json');
    vi.stubEnv('OPENCODE_AUTO_SHARE', 'true');
    mockedSpawn.mockImplementation(() => fakeChild(ndjsonText('{"findings": []}')) as never);
    const provider = new OpenCodeProvider(
      () => 'opencode',
      () => '',
      new ReviewPromptBuilder(repoRoot),
    );
    await provider.listModels();
    await provider.review(context(), options());
    for (const call of mockedSpawn.mock.calls) {
      const opts = call[2] as SpawnOptions;
      expect(opts.shell).toBe(false);
      expect(String(opts.cwd)).toContain('azure-pr-review-');
      expect(existsSync(String(opts.cwd))).toBe(false);
      expect(opts.env?.OPENCODE_PERMISSION).toBe('{"*":"deny"}');
      expect(opts.env?.OPENCODE_CONFIG).toBeUndefined();
      expect(opts.env?.OPENCODE_AUTO_SHARE).toBe('false');
      expect(opts.env?.OPENCODE_DISABLE_PROJECT_CONFIG).toBe('true');
      const config = JSON.parse(opts.env!.OPENCODE_CONFIG_CONTENT!);
      expect(config.permission).toBe('deny');
      expect(config.share).toBe('disabled');
      if ((call[1] as string[])[0] === 'run') {
        const args = call[1] as string[];
        expect(config.agent[args[args.indexOf('--agent') + 1]].permission).toBe('deny');
      }
    }
  });

  it('never spawns a workspace-relative executable', async () => {
    const provider = new OpenCodeProvider(
      () => './malicious-cli',
      () => '',
      new ReviewPromptBuilder(repoRoot),
    );
    expect(await provider.isAvailable()).toBe(false);
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('never spawns in an untrusted workspace or after cancellation', async () => {
    const provider = new OpenCodeProvider(
      () => 'opencode',
      () => '',
      new ReviewPromptBuilder(repoRoot),
    );
    Object.assign(vscode.workspace, { isTrusted: false });
    expect(await provider.isAvailable()).toBe(false);
    Object.assign(vscode.workspace, { isTrusted: true });
    const token = new vscode.CancellationTokenSource();
    token.cancel();
    await expect(provider.review(context(), options(), token.token)).rejects.toThrow('cancelled');
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('kills a child that exceeds the output limit instead of accepting truncated output', async () => {
    const child = fakeChild('x'.repeat(MAX_AI_RESPONSE_BYTES + 1));
    mockedSpawn.mockImplementation(() => child as never);
    const provider = new OpenCodeProvider(
      () => 'opencode',
      () => '',
      new ReviewPromptBuilder(repoRoot),
    );
    expect(await provider.listModels()).toEqual([]);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('does not disclose stderr in provider errors', async () => {
    const child = fakeChild('');
    child.stdin.end = () =>
      queueMicrotask(() => {
        child.stderr.emit('data', Buffer.from('PRIVATE_SOURCE_AND_CREDENTIAL'));
        child.emit('close', 1);
      });
    mockedSpawn
      .mockImplementationOnce(() => fakeChild('1.0') as never)
      .mockImplementation(() => child as never);
    const provider = new OpenCodeProvider(
      () => 'opencode',
      () => '',
      new ReviewPromptBuilder(repoRoot),
    );
    await expect(provider.review(context(), options())).rejects.toThrow('Check the CLI');
  });
});
