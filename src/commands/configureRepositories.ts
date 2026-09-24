import * as vscode from 'vscode';
import { Configuration } from '../config/Configuration';
import { AzureDevOpsClient } from '../azure/AzureDevOpsClient';
import { showLoadingQuickPick } from '../utils/loadingQuickPick';
import { AuthenticationError, toUserMessage } from '../utils/errors';
import { Logger } from '../utils/logger';

/**
 * Multi-select of the project's repositories, listed with the stored PAT. Falls back to typing
 * names when the list can't be fetched (e.g. not signed in yet during first-time setup).
 * Returns undefined if the user cancels.
 */
export async function pickRepositories(
  client: AzureDevOpsClient,
  organization: string,
  project: string,
  current: string[],
): Promise<string[] | undefined> {
  const picker = showLoadingQuickPick<vscode.QuickPickItem>(
    `Azure DevOps repositories in "${project}"`,
    'Loading repositories…',
    { canSelectMany: true },
  );
  let available: string[] = [];
  let failure: string | undefined;
  try {
    available = await client.listRepositories(organization, project);
  } catch (err) {
    Logger.getInstance().warn('Unable to list Azure DevOps repositories.', err);
    failure =
      err instanceof AuthenticationError
        ? 'Sign in to pick from the project’s repositories.'
        : toUserMessage(err);
  }
  if (picker.isClosed()) {
    return undefined; // dismissed while loading
  }
  if (available.length === 0) {
    picker.close();
    return promptRepositoryNames(current, failure ?? 'No repositories were found in this project.');
  }

  const listed = new Set(available.map((name) => name.toLowerCase()));
  const configured = new Set(current.map((name) => name.toLowerCase()));
  picker.setItems(
    [
      ...available.map((name) => ({ label: name, picked: configured.has(name.toLowerCase()) })),
      // Keep configured entries the project no longer lists, so they can be deselected.
      ...current
        .filter((name) => !listed.has(name.toLowerCase()))
        .map((name) => ({
          label: name,
          picked: true,
          description: '$(warning) not found in this project',
        })),
    ],
    { placeholder: 'Select the repositories to review pull requests from' },
  );
  const picked = await picker.result;
  if (!picked) {
    return undefined;
  }
  if (picked.length === 0) {
    vscode.window.showWarningMessage('Select at least one repository.');
    return undefined;
  }
  return picked.map((item) => item.label);
}

/** "Azure PR Review: Select Repositories" - add/remove repositories without re-entering the connection. */
export async function selectRepositories(
  config: Configuration,
  client: AzureDevOpsClient,
): Promise<void> {
  const { organization, project, repositories } = config.getConnection();
  if (!organization || !project) {
    await vscode.commands.executeCommand('azurePrReview.configure');
    return;
  }
  const picked = await pickRepositories(client, organization, project, repositories);
  if (!picked) {
    return;
  }
  await config.setRepositories(picked);
  vscode.window.showInformationMessage(
    `Showing pull requests from ${picked.length === 1 ? 'repository' : `${picked.length} repositories`}: ${picked.join(', ')}.`,
  );
}

async function promptRepositoryNames(
  current: string[],
  reason: string,
): Promise<string[] | undefined> {
  const value = await vscode.window.showInputBox({
    title: 'Azure DevOps repositories',
    prompt: `${reason} Enter one or more repository names, separated by commas.`,
    value: current.join(', '),
    placeHolder: 'e.g. web-app, api, shared-lib',
    ignoreFocusOut: true,
    validateInput: (text) =>
      parseRepositoryNames(text).length === 0 ? 'Enter at least one repository name.' : undefined,
  });
  return value === undefined ? undefined : parseRepositoryNames(value);
}

export function parseRepositoryNames(text: string): string[] {
  return text
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}
