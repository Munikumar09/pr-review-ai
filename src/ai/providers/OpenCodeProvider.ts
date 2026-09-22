import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extractOpenCodeText } from './openCodeOutput';
import {
  AIReviewProvider,
  AIReviewResult,
  ReviewContext,
  ReviewOptions,
} from '../AIReviewProvider';
import { ReviewPromptBuilder } from '../ReviewPromptBuilder';
import { ReviewResultParser } from '../ReviewResultParser';
import { Logger } from '../../utils/logger';
import { AIProviderUnavailableError, AIResponseMalformedError } from '../../utils/errors';
import { OperationCancelledError } from '../../utils/cancellation';

const AVAILABILITY_CHECK_TIMEOUT_MS = 5_000;
const REVIEW_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

/**
 * Invokes the OpenCode CLI as a controlled child process (requirement #22).
 * The provider never assumes a specific model and is fully isolated so it
 * can be swapped out later - it only exchanges the normalized ReviewContext
 * and structured JSON, nothing Azure-DevOps-specific.
 */
export class OpenCodeProvider implements AIReviewProvider {
  readonly id = 'opencode';
  readonly name = 'OpenCode';

  private readonly logger = Logger.getInstance();
  private readonly parser = new ReviewResultParser();

  constructor(
    /** Read live so changing "azurePrReview.opencode.command" applies without a reload. */
    private readonly getCommand: () => string,
    /** Read live so changing "azurePrReview.opencode.model" applies without a reload. */
    private readonly getModel: () => string,
    private readonly promptBuilder: ReviewPromptBuilder,
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      await this.run(['--version'], '', AVAILABILITY_CHECK_TIMEOUT_MS);
      return true;
    } catch (err) {
      this.logger.warn(
        `OpenCode CLI not detected via "${this.getCommand()} --version".`,
        String(err),
      );
      return false;
    }
  }

  /** Lists models the configured OpenCode CLI currently has access to, as "provider/model" strings. */
  async listModels(): Promise<string[]> {
    try {
      const stdout = await this.run(['models'], '', AVAILABILITY_CHECK_TIMEOUT_MS);
      return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    } catch (err) {
      this.logger.warn('Unable to list OpenCode models.', String(err));
      return [];
    }
  }

  async review(
    context: ReviewContext,
    options: ReviewOptions,
    cancellationToken?: vscode.CancellationToken,
  ): Promise<AIReviewResult> {
    if (!(await this.isAvailable())) {
      throw new AIProviderUnavailableError(
        this.name,
        `OpenCode was not found. Install it or set "azurePrReview.opencode.command" to the correct executable.`,
      );
    }

    const prompt = this.promptBuilder.build(context, options);
    const model = this.getModel();
    this.logger.info(
      `Running OpenCode review for PR #${context.pullRequest.id} (${context.files.length} files)` +
        `${model ? ` with model "${model}"` : ''}.`,
    );

    const args = ['run', '--format', 'json', '--pure'];
    if (model) {
      args.push('--model', model);
    }

    // Run in an empty scratch directory so the agent has no repository or workspace files to
    // read or write to (PR content is untrusted - requirement #39): it can only affect this
    // throwaway directory, which is deleted immediately after. It also cannot escape that
    // directory - verified live: a "write" tool call to an absolute path outside cwd is
    // auto-rejected ("The user rejected permission to use this specific tool call") because
    // OpenCode's non-interactive mode auto-denies its default "ask" permission for any path
    // outside the working directory when there is no terminal to actually ask.
    //
    // We deliberately do NOT write a project-level opencode.json to further restrict
    // permissions here (e.g. denying edit/bash outright): verified live that OpenCode requires
    // one-time interactive confirmation the first time ANY custom permission rule applies to a
    // project, in either direction (allow or deny) - with no TTY to confirm, the whole run hangs
    // until REVIEW_TIMEOUT_MS. That would break every real review, trading a redundant safety
    // net (we already don't rely on permission config; see above) for total unreliability.
    // Permissions are also never auto-approved (no --auto flag).
    const scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'azure-pr-review-'));
    let stdout: string;
    try {
      stdout = await this.run(args, prompt, REVIEW_TIMEOUT_MS, cancellationToken, scratchDir);
    } catch (err) {
      if (err instanceof OperationCancelledError) {
        throw err;
      }
      throw new AIProviderUnavailableError(
        this.name,
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      await fs.rm(scratchDir, { recursive: true, force: true });
    }

    const { text, error } = extractOpenCodeText(stdout);
    if (error) {
      throw new AIProviderUnavailableError(this.name, error);
    }
    if (!text.trim()) {
      throw new AIResponseMalformedError('OpenCode produced no output.');
    }

    const knownFilePaths = new Set(context.files.map((f) => f.path));
    return this.parser.parse(text, {
      minConfidence: options.minConfidence,
      maxFindings: options.maxFindings,
      knownFilePaths,
      providerId: this.id,
    });
  }

  /** Spawns the CLI, feeds `stdin` on standard input, and resolves with captured stdout. Never logs stdin/stdout content (may contain proprietary source). */
  private run(
    args: string[],
    stdin: string,
    timeoutMs: number,
    cancellationToken?: vscode.CancellationToken,
    cwd?: string,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(this.getCommand(), args, { stdio: ['pipe', 'pipe', 'pipe'], cwd });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const cleanup = () => {
        clearTimeout(timer);
        cancellationSubscription?.dispose();
      };

      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill();
        cleanup();
        reject(new Error(`OpenCode timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      const cancellationSubscription = cancellationToken?.onCancellationRequested(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill();
        cleanup();
        reject(new OperationCancelledError());
      });

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length < MAX_OUTPUT_BYTES) {
          stdout += chunk.toString('utf8');
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < MAX_OUTPUT_BYTES) {
          stderr += chunk.toString('utf8');
        }
      });

      child.on('error', (err) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(err);
      });

      child.on('close', (code) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (code !== 0) {
          reject(new Error(`OpenCode exited with code ${code}. ${truncateForError(stderr)}`));
          return;
        }
        resolve(stdout);
      });

      child.stdin.on('error', () => {
        // Swallow EPIPE if the process exits before we finish writing.
      });
      child.stdin.write(stdin);
      child.stdin.end();
    });
  }
}

function truncateForError(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 500 ? `${trimmed.slice(0, 500)}...` : trimmed;
}
