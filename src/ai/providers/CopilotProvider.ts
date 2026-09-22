import * as vscode from 'vscode';
import {
  AIReviewProvider,
  AIReviewResult,
  ReviewContext,
  ReviewOptions,
} from '../AIReviewProvider';
import { ReviewPromptBuilder } from '../ReviewPromptBuilder';
import { ReviewResultParser } from '../ReviewResultParser';
import { Logger } from '../../utils/logger';
import { AIProviderUnavailableError } from '../../utils/errors';
import { OperationCancelledError } from '../../utils/cancellation';
import { confirmPrompt } from '../confirmPrompt';
import { MAX_AI_RESPONSE_BYTES } from '../../utils/securityLimits';
import { AIResponseMalformedError } from '../../utils/errors';

const UNAVAILABLE_MESSAGE =
  'GitHub Copilot review integration is not available through the supported extension API in this environment.';

/**
 * Uses the supported `vscode.lm` Language Model API to send review requests
 * to a Copilot-backed chat model (requirement #23). This is a documented,
 * stable VS Code API - not UI scraping, keyboard automation, or an
 * undocumented internal API.
 *
 * If `vscode.lm` is unavailable, or no Copilot model can be selected (the
 * extension isn't installed, the user has no access, or consent hasn't been
 * granted), this provider degrades to a clean, clearly-explained
 * unavailable state and the rest of the extension keeps working.
 */
export class CopilotProvider implements AIReviewProvider {
  readonly id = 'copilot';
  readonly name = 'GitHub Copilot';

  private readonly logger = Logger.getInstance();
  private readonly parser = new ReviewResultParser();

  constructor(
    /** Read live so changing "azurePrReview.copilot.model" applies without a reload. */
    private readonly getModel: () => string,
    private readonly promptBuilder: ReviewPromptBuilder,
    private readonly secretDetectionEnabled: () => boolean = () => true,
  ) {}

  async isAvailable(): Promise<boolean> {
    if (!isLmApiPresent()) {
      return false;
    }
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      return models.length > 0;
    } catch (err) {
      this.logger.warn('Unable to query Copilot chat models.', err);
      return false;
    }
  }

  /** Chat models currently available to this user, for a "select a model" UI. */
  async listAvailableModels(): Promise<vscode.LanguageModelChat[]> {
    if (!isLmApiPresent()) {
      return [];
    }
    try {
      return await vscode.lm.selectChatModels({ vendor: 'copilot' });
    } catch (err) {
      this.logger.warn('Unable to query Copilot chat models.', err);
      return [];
    }
  }

  async review(
    context: ReviewContext,
    options: ReviewOptions,
    cancellationToken?: vscode.CancellationToken,
  ): Promise<AIReviewResult> {
    if (!isLmApiPresent()) {
      throw new AIProviderUnavailableError(this.name, UNAVAILABLE_MESSAGE);
    }

    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (models.length === 0) {
      throw new AIProviderUnavailableError(this.name, UNAVAILABLE_MESSAGE);
    }

    const model = this.selectModel(models);
    const prompt = this.promptBuilder.build(context, options);
    await confirmPrompt(prompt, this.secretDetectionEnabled(), cancellationToken);
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];

    this.logger.info(
      `Running Copilot review for PR #${context.pullRequest.id} via model "${model.name}".`,
    );

    let response: vscode.LanguageModelChatResponse;
    try {
      response = await model.sendRequest(messages, {}, cancellationToken);
    } catch (err) {
      if (isCancellation(err)) {
        throw new OperationCancelledError();
      }
      throw new AIProviderUnavailableError(
        this.name,
        'Copilot could not complete the review. Check model access and authentication.',
      );
    }

    let text = '';
    let responseBytes = 0;
    try {
      for await (const fragment of response.text) {
        if (cancellationToken?.isCancellationRequested) {
          throw new OperationCancelledError();
        }
        responseBytes += Buffer.byteLength(fragment, 'utf8');
        if (responseBytes > MAX_AI_RESPONSE_BYTES) {
          throw new AIResponseMalformedError('Copilot output exceeded the size limit.');
        }
        text += fragment;
      }
    } catch (err) {
      if (err instanceof OperationCancelledError || err instanceof AIResponseMalformedError) {
        throw err;
      }
      throw new AIProviderUnavailableError(
        this.name,
        'Copilot could not complete the review. Check model access and authentication.',
      );
    }

    const knownFilePaths = new Set(context.files.map((f) => f.path));
    return this.parser.parse(text, {
      minConfidence: options.minConfidence,
      maxFindings: options.maxFindings,
      knownFilePaths,
      providerId: this.id,
    });
  }

  /** Picks the configured model by id/family/name from what's available, falling back to the first one. */
  private selectModel(models: vscode.LanguageModelChat[]): vscode.LanguageModelChat {
    const preferred = this.getModel();
    if (preferred) {
      const match = models.find(
        (m) => m.id === preferred || m.family === preferred || m.name === preferred,
      );
      if (match) {
        return match;
      }
      this.logger.warn(
        `Configured Copilot model "${preferred}" is not currently available; using "${models[0].name}" instead.`,
      );
    }
    return models[0];
  }
}

function isLmApiPresent(): boolean {
  return typeof vscode.lm !== 'undefined' && typeof vscode.lm.selectChatModels === 'function';
}

function isCancellation(err: unknown): boolean {
  return err instanceof Error && err.name === 'Cancelled';
}
