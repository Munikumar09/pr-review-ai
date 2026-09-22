import * as vscode from 'vscode';
import { CONFIG_KEYS, EXTENSION_ID } from './ConfigurationKeys';
import { FindingCategory } from '../models/ReviewFinding';

export type AIProviderId = 'mock' | 'opencode' | 'copilot';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AzureDevOpsConnectionConfig {
  organization: string;
  project: string;
  repository: string;
}

/**
 * Thin typed wrapper around VS Code's Configuration API. Nothing here reads
 * secrets - PAT storage lives exclusively behind SecretStorage
 * (see azure/AzureDevOpsAuth.ts).
 */
export class Configuration {
  private get section(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(EXTENSION_ID);
  }

  /** Security-sensitive choices must come from the user's settings, never a repository. */
  private userSetting<T>(key: string, fallback: T): T {
    const setting = this.section.inspect<T>(key);
    return setting?.globalValue ?? setting?.defaultValue ?? fallback;
  }

  getConnection(): AzureDevOpsConnectionConfig {
    return {
      organization: this.userSetting<string>(CONFIG_KEYS.organization, ''),
      project: this.userSetting<string>(CONFIG_KEYS.project, ''),
      repository: this.userSetting<string>(CONFIG_KEYS.repository, ''),
    };
  }

  isConnectionConfigured(): boolean {
    const c = this.getConnection();
    return Boolean(c.organization && c.project && c.repository);
  }

  async setConnection(config: AzureDevOpsConnectionConfig): Promise<void> {
    const target = vscode.ConfigurationTarget.Global;
    await this.section.update(CONFIG_KEYS.organization, config.organization, target);
    await this.section.update(CONFIG_KEYS.project, config.project, target);
    await this.section.update(CONFIG_KEYS.repository, config.repository, target);
  }

  getAIProvider(): AIProviderId {
    return this.userSetting<AIProviderId>(CONFIG_KEYS.aiProvider, 'mock');
  }

  async setAIProvider(provider: AIProviderId): Promise<void> {
    await this.section.update(CONFIG_KEYS.aiProvider, provider, vscode.ConfigurationTarget.Global);
  }

  getAIMaxFindings(): number {
    const value = this.section.get<number>(CONFIG_KEYS.aiMaxFindings, 20);
    return Number.isFinite(value) ? Math.max(1, Math.min(100, Math.floor(value))) : 20;
  }

  getAIMinConfidence(): number {
    const value = this.section.get<number>(CONFIG_KEYS.aiMinConfidence, 0.75);
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.75;
  }

  getAIReviewCategories(): FindingCategory[] {
    return this.section.get<FindingCategory[]>(CONFIG_KEYS.aiReviewCategories, [
      'bug',
      'security',
      'performance',
      'maintainability',
      'testing',
    ]);
  }

  getOpenCodeCommand(): string {
    return this.userSetting<string>(CONFIG_KEYS.opencodeCommand, 'opencode');
  }

  /** Model passed to OpenCode as `-m provider/model`. Empty means "let OpenCode use its own default". */
  getOpenCodeModel(): string {
    return this.userSetting<string>(CONFIG_KEYS.opencodeModel, '').trim();
  }

  async setOpenCodeModel(model: string): Promise<void> {
    await this.section.update(CONFIG_KEYS.opencodeModel, model, vscode.ConfigurationTarget.Global);
  }

  /** Preferred Copilot chat model id/family. Empty means "use the first model VS Code offers". */
  getCopilotModel(): string {
    return this.userSetting<string>(CONFIG_KEYS.copilotModel, '').trim();
  }

  async setCopilotModel(model: string): Promise<void> {
    await this.section.update(CONFIG_KEYS.copilotModel, model, vscode.ConfigurationTarget.Global);
  }

  /** Extra instructions appended to (never replacing) the built-in review prompt. */
  getAICustomInstructions(): string {
    return this.userSetting<string>(CONFIG_KEYS.aiCustomInstructions, '').trim();
  }

  /** When false, published comments omit the "[AI Review - ...]" prefix, confidence and provider name. */
  isAIAttributionIncluded(): boolean {
    return this.section.get<boolean>(CONFIG_KEYS.aiIncludeAttribution, true);
  }

  async setAIAttributionIncluded(include: boolean): Promise<void> {
    await this.section.update(
      CONFIG_KEYS.aiIncludeAttribution,
      include,
      vscode.ConfigurationTarget.Global,
    );
  }

  getLogLevel(): LogLevel {
    return this.section.get<LogLevel>(CONFIG_KEYS.loggingLevel, 'info');
  }

  isSecretDetectionEnabled(): boolean {
    return this.userSetting<boolean>(CONFIG_KEYS.secretDetection, true);
  }

  onDidChange(listener: (e: vscode.ConfigurationChangeEvent) => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(EXTENSION_ID)) {
        listener(e);
      }
    });
  }
}
