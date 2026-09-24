import * as vscode from 'vscode';

export interface LoadingQuickPick<T extends vscode.QuickPickItem> {
  /** Resolves with the accepted items (exactly one unless `canSelectMany`), or undefined if dismissed. */
  readonly result: Promise<readonly T[] | undefined>;
  isClosed(): boolean;
  /** With `canSelectMany`, items marked `picked` start selected. */
  setItems(items: T[], options?: { placeholder?: string; busy?: boolean }): void;
  close(): void;
}

/**
 * Shows a QuickPick right away with a busy indicator, so slow lookups (CLI spawns, Language
 * Model API queries, Azure DevOps requests) don't leave the user waiting seconds with no
 * visible response.
 */
export function showLoadingQuickPick<T extends vscode.QuickPickItem>(
  title: string,
  placeholder: string,
  options: { canSelectMany?: boolean } = {},
): LoadingQuickPick<T> {
  const canSelectMany = options.canSelectMany ?? false;
  const quickPick = vscode.window.createQuickPick<T>();
  quickPick.title = title;
  quickPick.placeholder = placeholder;
  quickPick.canSelectMany = canSelectMany;
  quickPick.ignoreFocusOut = canSelectMany; // checking several boxes shouldn't be lost to a stray click
  quickPick.busy = true;
  let loaded = false;
  let closed = false;

  const result = new Promise<readonly T[] | undefined>((resolve) => {
    quickPick.onDidAccept(() => {
      const picked = quickPick.selectedItems;
      if (!loaded || (!canSelectMany && picked.length === 0)) {
        return;
      }
      resolve(picked);
      quickPick.hide();
    });
    quickPick.onDidHide(() => {
      closed = true;
      resolve(undefined);
      quickPick.dispose();
    });
  });
  quickPick.show();

  return {
    result,
    isClosed: () => closed,
    setItems(items, setOptions = {}) {
      // Replacing items resets the highlight; keep it on whatever the user had moved to.
      const activeLabel = quickPick.activeItems[0]?.label;
      quickPick.items = items;
      const active = items.find((item) => item.label === activeLabel);
      if (active) {
        quickPick.activeItems = [active];
      }
      if (canSelectMany) {
        // createQuickPick ignores `picked`; initial checks must be set explicitly.
        quickPick.selectedItems = items.filter((item) => item.picked);
      }
      if (setOptions.placeholder !== undefined) {
        quickPick.placeholder = setOptions.placeholder;
      }
      quickPick.busy = setOptions.busy ?? false;
      loaded = true;
    },
    close: () => quickPick.hide(),
  };
}
