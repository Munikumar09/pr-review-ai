import * as vscode from 'vscode';
import { PullRequest } from '../models/PullRequest';
import { isSameAzureRepository, parseAzureRemote } from '../utils/azureRemote';

/** The subset of the built-in `vscode.git` extension API this feature relies on. */
interface GitRemote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

export interface GitRepository {
  rootUri: vscode.Uri;
  state: {
    HEAD?: { name?: string; commit?: string };
    remotes: GitRemote[];
  };
}

interface GitApi {
  repositories: GitRepository[];
}

interface GitExtensionExports {
  getAPI(version: 1): GitApi;
}

/**
 * Finds the repository open in this window whose git remote is the Azure DevOps repository a
 * pull request belongs to, so files can be opened locally with full language-server support.
 */
export class LocalRepositoryLocator {
  async find(
    pullRequest: Pick<PullRequest, 'repositoryName' | 'projectName'>,
    organization: string,
  ): Promise<GitRepository | undefined> {
    const repositories = await this.getRepositories();
    const expected = {
      organization,
      project: pullRequest.projectName,
      repository: pullRequest.repositoryName,
    };
    return repositories.find((repo) =>
      repo.state.remotes.some((remote) =>
        [remote.fetchUrl, remote.pushUrl].some((url) => {
          const parsed = url ? parseAzureRemote(url) : undefined;
          return parsed !== undefined && isSameAzureRepository(parsed, expected);
        }),
      ),
    );
  }

  private async getRepositories(): Promise<GitRepository[]> {
    const extension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
    if (!extension) {
      return [];
    }
    const exports = extension.isActive ? extension.exports : await extension.activate();
    try {
      return exports.getAPI(1).repositories;
    } catch {
      // The git extension can be disabled by the user, in which case getAPI throws.
      return [];
    }
  }
}
