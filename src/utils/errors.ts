/** Base class for all errors the extension raises intentionally, carrying a concise user-facing message. */
export class AzurePrReviewError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string = message,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AuthenticationError extends AzurePrReviewError {
  constructor(cause?: unknown) {
    super(
      'Azure DevOps authentication failed',
      'Authentication failed. Check your Personal Access Token.',
      cause,
    );
  }
}

export class ConfigurationError extends AzurePrReviewError {
  constructor(message: string) {
    super(message, message);
  }
}

export class RepositoryNotFoundError extends AzurePrReviewError {
  constructor(repository: string, cause?: unknown) {
    super(`Repository not found: ${repository}`, `Repository not found: ${repository}`, cause);
  }
}

export class PullRequestNotFoundError extends AzurePrReviewError {
  constructor(id: number, cause?: unknown) {
    super(`Pull request not found: ${id}`, `Pull request #${id} not found.`, cause);
  }
}

export class FileContentError extends AzurePrReviewError {
  constructor(path: string, cause?: unknown) {
    super(
      `Unable to retrieve file content: ${path}`,
      `Unable to retrieve content for "${path}".`,
      cause,
    );
  }
}

export class ChangedFilesError extends AzurePrReviewError {
  constructor(cause?: unknown) {
    super(
      'Unable to fetch changed files',
      'Unable to fetch changed files for this pull request.',
      cause,
    );
  }
}

export class AIProviderUnavailableError extends AzurePrReviewError {
  constructor(providerName: string, detail?: string) {
    super(
      `AI provider unavailable: ${providerName}${detail ? ` (${detail})` : ''}`,
      detail ?? `The "${providerName}" AI provider is not available.`,
    );
  }
}

export class AIResponseMalformedError extends AzurePrReviewError {
  constructor(detail: string) {
    super(
      `AI response malformed: ${detail}`,
      'The AI provider returned a response that could not be parsed.',
    );
  }
}

export class LineMappingError extends AzurePrReviewError {
  constructor(detail: string) {
    super(`Line mapping failed: ${detail}`, 'Unable to map this finding to a changed line.');
  }
}

export class CommentPublicationError extends AzurePrReviewError {
  constructor(cause?: unknown) {
    super('Comment publication failed', 'Failed to publish comment to Azure DevOps.', cause);
  }
}

export class NetworkTimeoutError extends AzurePrReviewError {
  constructor(operation: string) {
    super(`Network timeout: ${operation}`, `Request timed out while performing: ${operation}.`);
  }
}

/** Extracts a safe, concise user-facing message from any thrown value. */
export function toUserMessage(error: unknown): string {
  if (error instanceof AzurePrReviewError) {
    return error.userMessage;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unexpected error occurred.';
}
