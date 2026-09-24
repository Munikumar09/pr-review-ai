import { describe, expect, it } from 'vitest';
import { AzureDevOpsClient } from '../../azure/AzureDevOpsClient';
import { AzureDevOpsAuthProvider } from '../../azure/AzureDevOpsAuth';
import { AuthenticationError, ConfigurationError } from '../../utils/errors';

function auth(token: string | undefined): AzureDevOpsAuthProvider {
  return {
    getToken: async () => token,
    authenticate: async () => {},
    logout: async () => {},
    onDidChangeSession: () => ({ dispose() {} }),
  };
}

describe('AzureDevOpsClient (no network)', () => {
  it('reports a configuration error, not an auth error, when the organization is empty', async () => {
    const client = new AzureDevOpsClient(auth('pat'), () => ({
      organization: '',
      project: 'p',
      repositories: ['r'],
    }));
    await expect(client.getPullRequest(1)).rejects.toBeInstanceOf(ConfigurationError);
  });

  it('reports an auth error when no PAT is stored', async () => {
    const client = new AzureDevOpsClient(auth(undefined), () => ({
      organization: 'org',
      project: 'p',
      repositories: ['r'],
    }));
    await expect(client.verifyConnection()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('reports a configuration error when no repository is configured', async () => {
    const client = new AzureDevOpsClient(auth('pat'), () => ({
      organization: 'org',
      project: 'p',
      repositories: [],
    }));
    await expect(client.verifyConnection()).rejects.toBeInstanceOf(ConfigurationError);
  });

  it('picks up settings changed after construction (Configure after activation)', async () => {
    let organization = '';
    const client = new AzureDevOpsClient(auth(undefined), () => ({
      organization,
      project: 'p',
      repositories: ['r'],
    }));

    await expect(client.verifyConnection()).rejects.toBeInstanceOf(ConfigurationError);

    organization = 'org';
    client.reset();
    await expect(client.verifyConnection()).rejects.toBeInstanceOf(AuthenticationError);
  });
});

// Opt-in: hits real dev.azure.com with a deliberately invalid PAT.
describe.skipIf(process.env.AZURE_E2E !== '1')(
  'AzureDevOpsClient (real network, invalid PAT)',
  () => {
    it('rejects a bad PAT with an AuthenticationError', async () => {
      const client = new AzureDevOpsClient(auth('not-a-real-pat'), () => ({
        organization: 'microsoft',
        project: 'OS',
        repositories: ['os'],
      }));
      await expect(client.verifyConnection()).rejects.toBeInstanceOf(AuthenticationError);
    }, 60_000);
  },
);
