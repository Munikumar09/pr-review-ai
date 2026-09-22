import * as vscode from 'vscode';
import { detectSecrets } from '../utils/secretDetection';
import { throwIfCancelled, OperationCancelledError } from '../utils/cancellation';
import { ConfigurationError } from '../utils/errors';
import { MAX_PROMPT_BYTES } from '../utils/securityLimits';

/** Scan the exact, immutable prompt sent to the external provider, including removed lines. */
export async function confirmPrompt(
  prompt: string,
  detect: boolean,
  cancellationToken?: vscode.CancellationToken,
): Promise<void> {
  throwIfCancelled(cancellationToken);
  if (!vscode.workspace.isTrusted) {
    throw new ConfigurationError('Trust this workspace before running an AI review.');
  }
  if (Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) {
    throw new ConfigurationError(
      'The review prompt is too large. Select fewer files or shorten the PR description and custom instructions.',
    );
  }
  const kinds = detect ? [...new Set(detectSecrets(prompt).map((match) => match.kind))] : [];
  if (kinds.length > 0) {
    const choice = await vscode.window.showWarningMessage(
      `Potential secret detected in the AI review prompt (${kinds.join(', ')}). Send this content to the AI provider?`,
      { modal: true },
      'Send to AI Provider',
    );
    if (choice !== 'Send to AI Provider') {
      throw new OperationCancelledError();
    }
  }
  throwIfCancelled(cancellationToken);
}
