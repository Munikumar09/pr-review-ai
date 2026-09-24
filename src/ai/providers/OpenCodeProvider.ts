import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
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
import { OperationCancelledError, throwIfCancelled } from '../../utils/cancellation';
import { confirmPrompt } from '../confirmPrompt';
import { MAX_AI_RESPONSE_BYTES } from '../../utils/securityLimits';

const AVAILABILITY_CHECK_TIMEOUT_MS = 5_000;
const REVIEW_TIMEOUT_MS = 180_000;
/** Each CLI spawn costs ~1-3s of startup, so successful lookups are reused for this long. */
const CLI_RESULT_CACHE_TTL_MS = 5 * 60_000;
const MAX_OUTPUT_BYTES = MAX_AI_RESPONSE_BYTES;

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
  /** Keyed by command so changing "azurePrReview.opencode.command" invalidates it. Only successes are cached. */
  private availabilityCache?: { command: string; expiresAt: number };
  private modelsCache?: { command: string; expiresAt: number; models: string[] };

  constructor(
    /** Read live so changing "azurePrReview.opencode.command" applies without a reload. */
    private readonly getCommand: () => string,
    /** Read live so changing "azurePrReview.opencode.model" applies without a reload. */
    private readonly getModel: () => string,
    private readonly promptBuilder: ReviewPromptBuilder,
    private readonly secretDetectionEnabled: () => boolean = () => true,
  ) {}

  async isAvailable(): Promise<boolean> {
    const command = this.getCommand();
    if (isFresh(this.availabilityCache, command)) {
      return true;
    }
    try {
      await this.run(['--version'], '', AVAILABILITY_CHECK_TIMEOUT_MS);
      this.availabilityCache = { command, expiresAt: Date.now() + CLI_RESULT_CACHE_TTL_MS };
      return true;
    } catch (err) {
      this.logger.warn(`OpenCode CLI not detected via "${this.getCommand()} --version".`, err);
      return false;
    }
  }

  /** Lists models the configured OpenCode CLI currently has access to, as "provider/model" strings. */
  async listModels(): Promise<string[]> {
    const command = this.getCommand();
    if (this.modelsCache && isFresh(this.modelsCache, command)) {
      return this.modelsCache.models;
    }
    try {
      const stdout = await this.run(['models'], '', AVAILABILITY_CHECK_TIMEOUT_MS);
      const models = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      if (models.length > 0) {
        this.modelsCache = { command, expiresAt: Date.now() + CLI_RESULT_CACHE_TTL_MS, models };
      }
      return models;
    } catch (err) {
      this.logger.warn('Unable to list OpenCode models.', err);
      return [];
    }
  }

  async review(
    context: ReviewContext,
    options: ReviewOptions,
    cancellationToken?: vscode.CancellationToken,
  ): Promise<AIReviewResult> {
    const prompt = this.promptBuilder.build(context, options);
    await confirmPrompt(prompt, this.secretDetectionEnabled(), cancellationToken);
    if (!(await this.isAvailable())) {
      throw new AIProviderUnavailableError(
        this.name,
        `OpenCode was not found. Install it or set "azurePrReview.opencode.command" to the correct executable.`,
      );
    }

    const model = this.getModel();
    this.logger.info(
      `Running OpenCode review for PR #${context.pullRequest.id} (${context.files.length} files)` +
        `${model ? ` with model "${model}"` : ''}.`,
    );

    const agentName = `azure-pr-review-${crypto.randomUUID()}`;
    const args = ['run', '--format', 'json', '--pure', '--agent', agentName];
    if (model) {
      args.push('--model', model);
    }

    // An empty cwd is not a sandbox. Deny every agent tool explicitly and never
    // reuse a configured agent whose per-agent permissions could override that policy.
    let stdout: string;
    try {
      stdout = await this.run(args, prompt, REVIEW_TIMEOUT_MS, cancellationToken, agentName);
    } catch (err) {
      if (err instanceof OperationCancelledError) {
        throw err;
      }
      throw new AIProviderUnavailableError(
        this.name,
        'OpenCode could not complete the review. Check the CLI installation, model and authentication.',
      );
    }

    const { text, error } = extractOpenCodeText(stdout);
    if (error) {
      throw new AIProviderUnavailableError(
        this.name,
        'OpenCode reported a provider error. Check the model and authentication.',
      );
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
  private async run(
    args: string[],
    stdin: string,
    timeoutMs: number,
    cancellationToken?: vscode.CancellationToken,
    agentName?: string,
  ): Promise<string> {
    throwIfCancelled(cancellationToken);
    if (!vscode.workspace.isTrusted) {
      throw new Error('Trust this workspace before running OpenCode.');
    }
    const command = this.getCommand();
    if (!command.trim() || (/[\\/]/.test(command) && !path.isAbsolute(command))) {
      throw new Error('Configure an absolute OpenCode executable path or a command on PATH.');
    }
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'azure-pr-review-'));
    try {
      throwIfCancelled(cancellationToken);
      return await new Promise<string>((resolve, reject) => {
        const env = { ...process.env };
        // Discard inherited OpenCode overrides (including automatic sharing/approval).
        for (const key of Object.keys(env)) {
          if (key.startsWith('OPENCODE_')) delete env[key];
        }
        Object.assign(env, {
          OPENCODE_PERMISSION: JSON.stringify({ '*': 'deny' }),
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            permission: 'deny',
            share: 'disabled',
            autoupdate: false,
            ...(agentName
              ? { agent: { [agentName]: { mode: 'primary', permission: 'deny' } } }
              : {}),
          }),
          OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
          OPENCODE_DISABLE_CLAUDE_CODE: 'true',
          OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true',
          OPENCODE_DISABLE_AUTOUPDATE: 'true',
          OPENCODE_AUTO_SHARE: 'false',
        });
        // Relative PATH entries must not resolve an executable from the workspace.
        const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
        env[pathKey] = (env[pathKey] ?? '')
          .split(path.delimiter)
          .filter((entry) => path.isAbsolute(entry))
          .join(path.delimiter);
        const child = spawn(command, args.includes('--pure') ? args : [...args, '--pure'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd,
          env,
          shell: false,
        });

        let stdout = '';
        let outputBytes = 0;
        let settled = false;
        let cancellationSubscription: vscode.Disposable | undefined = undefined;

        const cleanup = () => {
          clearTimeout(timer);
          cancellationSubscription?.dispose();
        };

        const timer = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          child.kill('SIGKILL');
          cleanup();
          reject(new Error(`OpenCode timed out after ${timeoutMs}ms.`));
        }, timeoutMs);

        cancellationSubscription = cancellationToken?.onCancellationRequested(() => {
          if (settled) {
            return;
          }
          settled = true;
          child.kill('SIGKILL');
          cleanup();
          reject(new OperationCancelledError());
        });

        const consume = (chunk: Buffer, capture: boolean) => {
          if (settled) return;
          outputBytes += chunk.length;
          if (outputBytes > MAX_OUTPUT_BYTES) {
            settled = true;
            child.kill('SIGKILL');
            cleanup();
            reject(new Error('OpenCode output exceeded the size limit.'));
            return;
          }
          if (capture) stdout += chunk.toString('utf8');
        };
        child.stdout.on('data', (chunk: Buffer) => consume(chunk, true));
        child.stderr.on('data', (chunk: Buffer) => consume(chunk, false));

        child.on('error', () => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          reject(new Error('Unable to start the OpenCode executable.'));
        });

        child.on('close', (code) => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          if (code !== 0) {
            reject(new Error(`OpenCode exited with code ${code}.`));
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
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  }
}

function isFresh(
  entry: { command: string; expiresAt: number } | undefined,
  command: string,
): boolean {
  return !!entry && entry.command === command && entry.expiresAt > Date.now();
}
