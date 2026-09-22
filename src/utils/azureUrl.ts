import * as vscode from 'vscode';
import { ConfigurationError } from './errors';

export function organizationUrl(organization: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,49}$/.test(organization)) {
    throw new ConfigurationError(
      'Enter an Azure DevOps organization name containing only letters, numbers and hyphens.',
    );
  }
  return `https://dev.azure.com/${organization}`;
}

/** Never hand an untrusted scheme (command:, file:, etc.) to the OS URI handler. */
export async function openAzureUrl(value: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError('The pull request URL is invalid.');
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'dev.azure.com' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  ) {
    throw new ConfigurationError('Only HTTPS pull request links on dev.azure.com can be opened.');
  }
  await vscode.env.openExternal(vscode.Uri.parse(url.href));
}
