import * as vscode from 'vscode';
import { Configuration, AIProviderId } from '../config/Configuration';
import { AIReviewProvider } from '../ai/AIReviewProvider';
import { OpenCodeProvider } from '../ai/providers/OpenCodeProvider';
import { CopilotProvider } from '../ai/providers/CopilotProvider';
import { showLoadingQuickPick } from '../utils/loadingQuickPick';

const PROVIDER_ORDER: AIProviderId[] = ['mock', 'opencode', 'copilot'];

const PROVIDER_DETAIL: Record<AIProviderId, string> = {
  mock: 'Offline, deterministic sample findings - use this to test the approve/publish workflow without an AI backend.',
  opencode:
    'Local OpenCode CLI - runs whatever model(s) you have configured with "opencode auth login".',
  copilot: 'GitHub Copilot Chat, via the built-in VS Code Language Model API.',
};

interface ProviderQuickPickItem extends vscode.QuickPickItem {
  id: AIProviderId;
}

/**
 * "Azure PR Review: Select AI Provider" - lets the user pick mock/OpenCode/Copilot.
 *
 * The picker opens immediately; availability checks (an OpenCode CLI spawn, a Copilot model
 * query - each can take seconds) run in parallel and fill in the descriptions as they finish.
 */
export async function selectAIProvider(
  config: Configuration,
  providers: Map<string, AIReviewProvider>,
): Promise<void> {
  const current = config.getAIProvider();
  const availability = new Map<AIProviderId, boolean>();
  const buildItems = (): ProviderQuickPickItem[] =>
    PROVIDER_ORDER.map((id) => {
      const status = availability.get(id);
      return {
        id,
        label: providers.get(id)?.name ?? id,
        description: [
          id === current ? '(current)' : '',
          id === 'mock'
            ? ''
            : status === undefined
              ? '$(loading~spin) checking…'
              : status
                ? '$(check) available'
                : '$(warning) not detected',
        ]
          .filter(Boolean)
          .join(' '),
        detail: PROVIDER_DETAIL[id],
      };
    });

  const picker = showLoadingQuickPick<ProviderQuickPickItem>(
    'Azure PR Review: AI Provider',
    `Current provider: ${providers.get(current)?.name ?? current}`,
  );
  picker.setItems(buildItems(), { busy: true });

  const checks = PROVIDER_ORDER.filter((id) => id !== 'mock').map(async (id) => {
    const provider = providers.get(id);
    availability.set(id, provider ? await provider.isAvailable().catch(() => false) : false);
    if (!picker.isClosed()) {
      picker.setItems(buildItems(), { busy: availability.size < PROVIDER_ORDER.length - 1 });
    }
  });
  void Promise.all(checks);

  const [choice] = (await picker.result) ?? [];
  if (!choice || choice.id === current) {
    return;
  }
  await config.setAIProvider(choice.id);
  vscode.window.showInformationMessage(`AI review provider set to "${choice.label}".`);
}

/** "Azure PR Review: Select AI Model" - model choice is provider-specific. */
export async function selectAIModel(
  config: Configuration,
  providers: Map<string, AIReviewProvider>,
): Promise<void> {
  const providerId = config.getAIProvider();
  const provider = providers.get(providerId);

  if (providerId === 'mock') {
    vscode.window.showInformationMessage('The Mock provider has no model to select.');
    return;
  }
  if (providerId === 'opencode' && provider instanceof OpenCodeProvider) {
    await selectOpenCodeModel(config, provider);
    return;
  }
  if (providerId === 'copilot' && provider instanceof CopilotProvider) {
    await selectCopilotModel(config, provider);
    return;
  }
  vscode.window.showWarningMessage(
    'Select an AI provider first (Azure PR Review: Select AI Provider).',
  );
}

async function selectOpenCodeModel(
  config: Configuration,
  provider: OpenCodeProvider,
): Promise<void> {
  const current = config.getOpenCodeModel();
  const picker = showLoadingQuickPick<vscode.QuickPickItem & { value: string }>(
    'Azure PR Review: OpenCode Model',
    'Fetching OpenCode models…',
  );
  const models = await provider.listModels();
  if (picker.isClosed()) {
    return; // dismissed while loading
  }

  if (models.length === 0) {
    picker.close();
    const manual = await vscode.window.showInputBox({
      title: 'OpenCode model (provider/model)',
      prompt:
        'Could not list models from the OpenCode CLI (is it installed and signed in?). You can still enter one manually.',
      value: current,
      placeHolder: 'e.g. anthropic/claude-sonnet-4-5',
    });
    if (manual !== undefined) {
      await config.setOpenCodeModel(manual.trim());
      vscode.window.showInformationMessage(
        manual.trim()
          ? `OpenCode model set to "${manual.trim()}".`
          : 'OpenCode will use its own default model.',
      );
    }
    return;
  }

  const items: (vscode.QuickPickItem & { value: string })[] = [
    {
      value: '',
      label: 'Use OpenCode default',
      description: current ? '' : '(current)',
    },
    ...models.map((m) => ({ value: m, label: m, description: m === current ? '(current)' : '' })),
  ];
  picker.setItems(items, { placeholder: current || 'Using OpenCode default' });
  const [choice] = (await picker.result) ?? [];
  if (!choice) {
    return;
  }
  await config.setOpenCodeModel(choice.value);
  vscode.window.showInformationMessage(
    choice.value
      ? `OpenCode model set to "${choice.value}".`
      : 'OpenCode will use its own default model.',
  );
}

/**
 * "Azure PR Review: Edit Custom Review Prompt" - the setting exists (a multiline textarea in
 * Settings UI), but nothing in the extension's own UI pointed to it. This jumps straight there
 * instead of making people search Settings for it.
 */
export async function editCustomInstructions(): Promise<void> {
  await vscode.commands.executeCommand(
    'workbench.action.openSettings',
    'azurePrReview.ai.customInstructions',
  );
}

/** "Azure PR Review: Toggle AI Attribution in Comments" - quick on/off without opening Settings. */
export async function toggleAIAttribution(config: Configuration): Promise<void> {
  const current = config.isAIAttributionIncluded();
  const items: (vscode.QuickPickItem & { value: boolean })[] = [
    {
      value: true,
      label: `${current ? '$(check) ' : ''}Include AI attribution`,
      detail:
        'Comments are labeled "[AI Review - severity - category]" and end with the confidence percentage and provider name.',
    },
    {
      value: false,
      label: `${!current ? '$(check) ' : ''}Plain comment, no AI attribution`,
      detail:
        'Only the title, description and suggested fix are published - nothing indicates it came from an AI reviewer.',
    },
  ];
  const choice = await vscode.window.showQuickPick(items, {
    title: 'Azure PR Review: Published Comment Content',
    placeHolder: current
      ? 'Currently including AI attribution'
      : 'Currently publishing plain comments',
  });
  if (!choice || choice.value === current) {
    return;
  }
  await config.setAIAttributionIncluded(choice.value);
  vscode.window.showInformationMessage(
    choice.value
      ? 'Published comments will include AI attribution again.'
      : 'Published comments will no longer mention AI, confidence, or provider.',
  );
}

async function selectCopilotModel(config: Configuration, provider: CopilotProvider): Promise<void> {
  const current = config.getCopilotModel();
  const picker = showLoadingQuickPick<vscode.QuickPickItem & { value: string }>(
    'Azure PR Review: Copilot Model',
    'Fetching Copilot models…',
  );
  const models = await provider.listAvailableModels();
  if (picker.isClosed()) {
    return; // dismissed while loading
  }
  if (models.length === 0) {
    picker.close();
    vscode.window.showWarningMessage(
      'No Copilot chat models are currently available. Make sure GitHub Copilot Chat is installed and you are signed in.',
    );
    return;
  }

  const items: (vscode.QuickPickItem & { value: string })[] = [
    { value: '', label: 'Use first available model', description: current ? '' : '(current)' },
    ...models.map((m) => ({
      value: m.id,
      label: m.name,
      description: [m.family, m.id === current ? '(current)' : ''].filter(Boolean).join(' · '),
    })),
  ];
  picker.setItems(items, { placeholder: current || 'Using first available model' });
  const [choice] = (await picker.result) ?? [];
  if (!choice) {
    return;
  }
  await config.setCopilotModel(choice.value);
  vscode.window.showInformationMessage(
    choice.value
      ? `Copilot model set to "${choice.label}".`
      : 'Copilot will use the first available model.',
  );
}
