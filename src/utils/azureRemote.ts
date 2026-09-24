export interface AzureRemote {
  organization: string;
  project: string;
  repository: string;
}

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * Parses a git remote URL pointing at Azure DevOps into organization/project/repository.
 * Supports https (dev.azure.com and legacy *.visualstudio.com) and ssh (ssh.dev.azure.com,
 * vs-ssh.visualstudio.com) forms. Returns undefined for anything else.
 */
export function parseAzureRemote(remoteUrl: string): AzureRemote | undefined {
  const url = remoteUrl.trim();

  // ssh: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
  const ssh = url.match(
    /^(?:ssh:\/\/)?[^@/\s]+@(?:ssh\.dev\.azure\.com|vs-ssh\.visualstudio\.com)[:/](?:v3\/)?([^/]+)\/([^/]+)\/([^/]+?)\/?$/i,
  );
  if (ssh) {
    return {
      organization: safeDecode(ssh[1]),
      project: safeDecode(ssh[2]),
      repository: safeDecode(ssh[3]),
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return undefined;
  }
  const segments = parsed.pathname.split('/').filter(Boolean).map(safeDecode);
  const host = parsed.hostname.toLowerCase();

  if (host === 'dev.azure.com') {
    // /{org}/{project}/_git/{repo}
    const gitIndex = segments.indexOf('_git');
    if (gitIndex === 2 && segments[3]) {
      return { organization: segments[0], project: segments[1], repository: segments[3] };
    }
    return undefined;
  }

  if (host.endsWith('.visualstudio.com')) {
    // https://{org}.visualstudio.com/[DefaultCollection/]{project}/_git/{repo}
    const organization = host.slice(0, -'.visualstudio.com'.length);
    const rest = segments[0]?.toLowerCase() === 'defaultcollection' ? segments.slice(1) : segments;
    if (rest[1] === '_git' && rest[2]) {
      return { organization, project: rest[0], repository: rest[2] };
    }
    // {org}.visualstudio.com/_git/{repo} - project is the repository
    if (rest[0] === '_git' && rest[1]) {
      return { organization, project: rest[1], repository: rest[1] };
    }
  }
  return undefined;
}

const stripGitSuffix = (name: string): string => name.replace(/\.git$/i, '');

/** Case-insensitive comparison, as Azure DevOps names are. */
export function isSameAzureRepository(remote: AzureRemote, expected: AzureRemote): boolean {
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  return (
    eq(remote.organization, expected.organization) &&
    eq(remote.project, expected.project) &&
    eq(stripGitSuffix(remote.repository), stripGitSuffix(expected.repository))
  );
}

/**
 * Converts an Azure DevOps file path ("/src/a.ts") to a repo-relative path segment list.
 * Returns undefined when the path is empty or tries to escape the repository root.
 */
export function toRepoRelativeSegments(filePath: string): string[] | undefined {
  const segments = filePath.split(/[\\/]+/).filter((s) => s !== '' && s !== '.');
  if (segments.length === 0 || segments.includes('..')) {
    return undefined;
  }
  return segments;
}

/** Normalizes "refs/heads/feature/x" and "feature/x" to "feature/x". */
export function shortBranchName(ref: string): string {
  return ref.replace(/^refs\/heads\//, '');
}
