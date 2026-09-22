import * as vscode from 'vscode';
import { SECRET_KEYS } from '../config/ConfigurationKeys';
import { Logger } from '../utils/logger';

/**
 * Authentication is behind an interface so a future OAuth/Microsoft Entra ID
 * (AAD) flow can be added without touching callers (see requirement #6).
 */
export interface AzureDevOpsAuthProvider {
  getToken(): Promise<string | undefined>;
  authenticate(): Promise<void>;
  logout(): Promise<void>;
  readonly onDidChangeSession: vscode.Event<void>;
}

/**
 * Personal Access Token authentication. The token is stored exclusively in
 * VS Code SecretStorage - never in settings.json, workspace files, .env
 * files, source code, or logs (see requirement #6).
 */
export class PatAuthProvider implements AzureDevOpsAuthProvider {
  private readonly logger = Logger.getInstance();
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeSession = this.emitter.event;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getToken(): Promise<string | undefined> {
    return this.secrets.get(SECRET_KEYS.pat);
  }

  async authenticate(): Promise<void> {
    const pat = await vscode.window.showInputBox({
      title: 'Azure DevOps Personal Access Token',
      prompt: 'Enter a Personal Access Token with Code (Read & Write) and Pull Request scopes.',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim().length === 0 ? 'A token is required.' : undefined),
    });

    if (!pat) {
      this.logger.info('Sign-in cancelled by user.');
      return;
    }

    await this.secrets.store(SECRET_KEYS.pat, pat.trim());
    this.logger.info('Personal Access Token stored securely.');
    this.emitter.fire();
  }

  async logout(): Promise<void> {
    await this.secrets.delete(SECRET_KEYS.pat);
    this.logger.info('Signed out of Azure DevOps.');
    this.emitter.fire();
  }
}
