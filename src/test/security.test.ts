import { PassThrough } from 'stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { Configuration } from '../config/Configuration';
import { StateStore } from '../storage/StateStore';
import { ReviewSession } from '../models/ReviewSession';
import { PullRequest } from '../models/PullRequest';
import { PRReviewPanel, isPanelMessage } from '../webview/PRReviewPanel';
import { streamToString } from '../azure/AzureDevOpsClient';
import { PullRequestDiffService } from '../azure/PullRequestDiffService';
import { AzureDevOpsClient } from '../azure/AzureDevOpsClient';
import { MAX_FILE_BYTES } from '../utils/securityLimits';
import { openAzureUrl, organizationUrl } from '../utils/azureUrl';
import { redactSecrets, registerSecret } from '../utils/secretDetection';
import { Logger } from '../utils/logger';

afterEach(() => vi.restoreAllMocks());

describe('configuration trust', () => {
  it('ignores malicious workspace overrides for executable, destination and secret detection', () => {
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: () => './attacker',
      inspect: (key: string) => ({
        workspaceValue: key === 'security.secretDetection' ? false : './attacker',
        globalValue: key === 'opencode.command' ? '/usr/bin/opencode' : undefined,
      }),
    } as unknown as vscode.WorkspaceConfiguration);
    const config = new Configuration();
    expect(config.getOpenCodeCommand()).toBe('/usr/bin/opencode');
    expect(config.getAIProvider()).toBe('mock');
    expect(config.getAICustomInstructions()).toBe('');
    expect(config.getConnection().organization).toBe('');
    expect(config.isSecretDetectionEnabled()).toBe(true);
  });

  it.each(['../other', 'org?redirect=evil', 'org#fragment', 'org/../../evil', 'https://evil.test'])(
    'rejects organization path injection: %s',
    (value) => {
      expect(() => organizationUrl(value)).toThrow();
    },
  );

  it.each([
    'command:workbench.action.closeWindow',
    'file:///etc/passwd',
    'http://dev.azure.com/org',
    'https://dev.azure.com.evil.test/org',
    'https://user:secret@dev.azure.com/org',
  ])('refuses unsafe external URLs: %s', async (url) => {
    const open = vi.spyOn(vscode.env, 'openExternal');
    await expect(openAzureUrl(url)).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  });
});

describe('repository isolation', () => {
  it('keeps colliding PR numbers and drafts separate and does not restore unscoped legacy state', async () => {
    const values = new Map<string, unknown>();
    const context = {
      workspaceState: {
        get: <T>(key: string, fallback: T) => values.get(key) ?? fallback,
        update: async (key: string, value: unknown) => {
          values.set(key, value);
        },
      },
    } as unknown as vscode.ExtensionContext;
    const a = new StateStore(context, 'org-a/project/repo');
    const b = new StateStore(context, 'org-b/project/repo');
    const session = { id: 'session-a', pullRequestId: 1, findings: [] } as unknown as ReviewSession;
    values.set('azurePrReview.reviewSessions', [session]);
    expect(a.getReviewSessions()).toEqual([]);
    await a.saveReviewSession(session);
    await a.saveDraftComments(1, [
      { id: 'draft-a', pullRequestId: 1, content: 'private', filePath: 'a.ts', createdAt: '' },
    ]);
    expect(b.getReviewSession(1)).toBeUndefined();
    expect(b.getDraftComments(1)).toEqual([]);
    expect(new StateStore(context, 'org-a/project/repo').getReviewSession(1)).toEqual(session);
    await a.saveReviewSession({ ...session, id: 'replacement' });
    expect(a.getReviewSessions()).toHaveLength(1);
  });
});

describe('multi-repository state migration', () => {
  function memento(values: Map<string, unknown>) {
    return {
      workspaceState: {
        get: <T>(key: string, fallback: T) => values.get(key) ?? fallback,
        update: async (key: string, value: unknown) => {
          if (value === undefined) values.delete(key);
          else values.set(key, value);
        },
      },
    } as unknown as vscode.ExtensionContext;
  }
  const legacyScope = (repository: string) =>
    JSON.stringify({ organization: 'org', project: 'proj', repository });

  it('adopts single-repository state for configured repositories only, once', async () => {
    const values = new Map<string, unknown>();
    const context = memento(values);
    const api = new StateStore(context, legacyScope('api'));
    const other = new StateStore(context, legacyScope('other'));
    const session = (pullRequestId: number, id: string) =>
      ({ id, pullRequestId, findings: [] }) as unknown as ReviewSession;
    await api.saveReviewSession(session(1, 'legacy-1'));
    await api.saveReviewSession(session(2, 'legacy-2'));
    await api.saveDraftComments(1, [
      { id: 'd', pullRequestId: 1, content: 'draft', filePath: 'a.ts', createdAt: '' },
    ]);
    await other.saveReviewSession(session(3, 'unrelated'));

    const project = new StateStore(
      context,
      JSON.stringify({ organization: 'org', project: 'proj' }),
    );
    await project.saveReviewSession(session(2, 'newer'));
    await project.adoptLegacyScopes([legacyScope('api')]);

    expect(project.getReviewSession(1)?.id).toBe('legacy-1');
    expect(project.getReviewSession(2)?.id).toBe('newer');
    expect(project.getReviewSession(3)).toBeUndefined();
    expect(project.getDraftComments(1)).toHaveLength(1);
    expect(api.getReviewSessions()).toEqual([]);
    expect(other.getReviewSession(3)?.id).toBe('unrelated');

    await project.clearReviewSession(1);
    await project.adoptLegacyScopes([legacyScope('api')]);
    expect(project.getReviewSession(1)).toBeUndefined();
  });
});

describe('webview boundary', () => {
  it('escapes hostile content and finding IDs under a nonce-only script policy', () => {
    const create = vi.spyOn(vscode.window, 'createWebviewPanel');
    const hostile = '"><script>attack()</script><img src="https://evil.test" onerror="attack()">';
    const pr: PullRequest = {
      id: 1,
      title: hostile,
      description: '',
      status: 'active',
      isDraft: false,
      sourceBranch: 'feature',
      targetBranch: 'main',
      repositoryId: 'r',
      repositoryName: 'repo',
      projectId: 'p',
      projectName: 'project',
      createdBy: 'dev',
      creationDate: '',
      lastUpdateDate: '',
      url: '',
      webUrl: '',
    };
    const panel = new PRReviewPanel(pr);
    panel.update({
      pullRequest: pr,
      files: [],
      session: {
        id: 's',
        pullRequestId: 1,
        provider: 'mock',
        status: 'completed',
        startedAt: '',
        filesReviewed: 1,
        filesSkipped: 0,
        findings: [
          {
            id: hostile,
            title: hostile,
            description: hostile,
            severity: 'high',
            category: 'security',
            filePath: 'a.ts',
            startLine: 1,
            endLine: 1,
            confidence: 1,
            provider: 'mock',
            status: 'pending',
          },
        ],
      },
    });
    const webview = create.mock.results[0].value.webview;
    expect(webview.html).not.toContain(hostile);
    expect(webview.html).not.toContain('onclick=');
    expect(webview.html).not.toContain("'unsafe-inline'");
    expect(webview.html).toMatch(/script-src 'nonce-[A-Za-z0-9+/]+'/);
    expect(create.mock.calls[0][3]).toMatchObject({ localResourceRoots: [] });
    const handler = vi.fn();
    panel.onDidReceiveMessage(handler);
    create.mock.results[0].value.__test.postMessage({ type: 'approve', findingId: {} });
    expect(handler).not.toHaveBeenCalled();
    panel.dispose();
  });

  it.each([
    null,
    [],
    'approve',
    { type: 'executeCommand' },
    { type: 'approve' },
    { type: 'approve', findingId: 1 },
  ])('rejects malformed messages: %j', (value) => {
    expect(isPanelMessage(value)).toBe(false);
  });
});

describe('bounded untrusted content', () => {
  it('destroys an oversized download', async () => {
    const stream = new PassThrough();
    const result = streamToString(stream);
    stream.end(Buffer.alloc(MAX_FILE_BYTES + 1));
    await expect(result).rejects.toThrow('2 MiB');
    expect(stream.destroyed).toBe(true);
  });

  it('rejects prematurely closed streams and still accepts normal UTF-8 content', async () => {
    const truncated = new PassThrough();
    const result = streamToString(truncated);
    truncated.destroy();
    await expect(result).rejects.toThrow('before completion');
    const normal = new PassThrough();
    const content = streamToString(normal);
    normal.end('hello 🌍');
    await expect(content).resolves.toBe('hello 🌍');
  });

  it('fails closed when a pathological diff exceeds its edit budget', async () => {
    const cache = { getCached: () => undefined, setCached: () => {} } as unknown as StateStore;
    const client = {
      getLatestIterationCommits: async () => ({ sourceCommitId: 'new', targetCommitId: 'old' }),
      getFileContent: async (_pullRequestId: number, _path: string, commit: string) =>
        Array.from({ length: 3000 }, (_, i) => `${commit}-${i}`).join('\n'),
    } as unknown as AzureDevOpsClient;
    await expect(
      new PullRequestDiffService(client, cache).getFileDiff(1, {
        path: 'hostile.txt',
        changeType: 'edit',
        additions: 0,
        deletions: 0,
      }),
    ).rejects.toThrow('Unable to retrieve file content');
  });
});

it('redacts known credentials and never logs arbitrary exception/request details', () => {
  registerSecret('opaque-credential-that-does-not-match-patterns');
  expect(redactSecrets('value: opaque-credential-that-does-not-match-patterns')).not.toContain(
    'opaque-credential',
  );
  const output = vi.fn();
  vi.spyOn(vscode.window, 'createOutputChannel').mockReturnValue({
    appendLine: output,
  } as never);
  const logger = Logger.getInstance();
  logger.error('Download failed', new Error('PRIVATE_SOURCE_AND_CREDENTIAL'));
  logger.warn('Request failed', { headers: { Authorization: 'PRIVATE_AUTHORIZATION' } });
  expect(output).toHaveBeenCalled();
  expect(JSON.stringify(output.mock.calls)).not.toMatch(/PRIVATE_/);
});
