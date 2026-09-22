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
    expect(runCall?.[1]).toEqual(['run', '--format', 'json', '--pure']);
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
    expect(mockedSpawn.mock.calls[0][1]).toEqual(['models']);
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
