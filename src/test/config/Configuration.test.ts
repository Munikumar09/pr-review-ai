import * as vscode from 'vscode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Configuration, isRepositoryConfigured } from '../../config/Configuration';

function stubSettings(global: Record<string, unknown>, workspace: Record<string, unknown> = {}) {
  const update = vi.fn(async () => {});
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
    get: (_key: string, fallback?: unknown) => fallback,
    inspect: (key: string) => ({ globalValue: global[key], workspaceValue: workspace[key] }),
    update,
  } as never);
  return update;
}

describe('Configuration repositories', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('merges the legacy single repository into the list, de-duplicating case-insensitively', () => {
    stubSettings({
      organization: 'org',
      project: 'proj',
      repositories: [' api ', 'Web', 'API', 42, ''],
      repository: 'web',
    });
    const connection = new Configuration().getConnection();
    expect(connection.repositories).toEqual(['api', 'Web']);
    expect(new Configuration().isConnectionConfigured()).toBe(true);
  });

  it('still honors a configuration that only has the legacy setting', () => {
    stubSettings({ organization: 'org', project: 'proj', repository: 'legacy' });
    expect(new Configuration().getConnection().repositories).toEqual(['legacy']);
  });

  it('ignores repositories added by workspace settings', () => {
    stubSettings(
      { organization: 'org', project: 'proj', repositories: ['api'] },
      { repositories: ['attacker'], repository: 'attacker' },
    );
    expect(new Configuration().getConnection().repositories).toEqual(['api']);
  });

  it('is not configured without at least one repository', () => {
    stubSettings({ organization: 'org', project: 'proj', repositories: [] });
    expect(new Configuration().isConnectionConfigured()).toBe(false);
  });

  it('saves repositories to user settings and clears the legacy setting', async () => {
    const update = stubSettings({});
    await new Configuration().setRepositories(['api', 'API', 'web']);
    expect(update).toHaveBeenCalledWith(
      'repositories',
      ['api', 'web'],
      vscode.ConfigurationTarget.Global,
    );
    expect(update).toHaveBeenCalledWith('repository', undefined, vscode.ConfigurationTarget.Global);
  });

  it('matches a repository by name or id, ignoring case', () => {
    expect(isRepositoryConfigured(['API'], { id: 'x', name: 'api' })).toBe(true);
    expect(isRepositoryConfigured(['guid-1'], { id: 'GUID-1', name: 'api' })).toBe(true);
    expect(isRepositoryConfigured(['web'], { id: 'x', name: 'api' })).toBe(false);
    expect(isRepositoryConfigured([], { name: 'api' })).toBe(false);
  });
});
