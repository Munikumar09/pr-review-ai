/**
 * Minimal stand-in for the `vscode` module so pure logic modules that only
 * use vscode as *types* (erased at compile time) can still be imported by
 * unit tests running outside the extension host, on the rare path where a
 * runtime symbol (e.g. an enum-like const) is touched.
 */
export enum CommentThreadStatus {
  Unknown = 0,
  Active = 1,
  Fixed = 2,
  WontFix = 3,
  Closed = 4,
  ByDesign = 5,
  Pending = 6,
}

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];

  event = (listener: (e: T) => void): { dispose: () => void } => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      },
    };
  };

  fire(data: T): void {
    for (const listener of this.listeners) {
      listener(data);
    }
  }

  dispose(): void {
    this.listeners = [];
  }
}

export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
  Two = 2,
}

export const env = {
  clipboard: {
    writeText: async (_text: string): Promise<void> => {},
  },
  openExternal: async (_uri: unknown): Promise<boolean> => true,
};

export const window = {
  createOutputChannel: (_name: string) => ({
    appendLine: (_line: string) => {},
    show: (_preserveFocus?: boolean) => {},
    dispose: () => {},
  }),
  showErrorMessage: async (..._args: unknown[]): Promise<string | undefined> => undefined,
  showWarningMessage: async (..._args: unknown[]): Promise<string | undefined> => undefined,
  showInformationMessage: async (..._args: unknown[]): Promise<string | undefined> => undefined,
  showInputBox: async (..._args: unknown[]): Promise<string | undefined> => undefined,
  showQuickPick: async (..._args: unknown[]): Promise<unknown> => undefined,
  /**
   * Test-only fake of a WebviewPanel. Returns a plain object shaped like the
   * subset of vscode.WebviewPanel the extension actually uses, plus a
   * `__test` escape hatch so tests can simulate the webview posting a
   * message back (e.g. a button click) without a real webview host.
   */
  createWebviewPanel: (
    _viewType: string,
    title: string,
    _showOptions: unknown,
    _options: unknown,
  ) => {
    const messageEmitter = new EventEmitter<unknown>();
    const disposeEmitter = new EventEmitter<void>();
    return {
      title,
      webview: {
        html: '',
        onDidReceiveMessage: messageEmitter.event,
        postMessage: async (_message: unknown): Promise<boolean> => true,
      },
      onDidDispose: disposeEmitter.event,
      reveal: (_column?: unknown, _preserveFocus?: boolean): void => {},
      dispose: (): void => disposeEmitter.fire(),
      __test: {
        postMessage: (message: unknown): void => messageEmitter.fire(message),
        fireDispose: (): void => disposeEmitter.fire(),
      },
    };
  },
};

export class MarkdownString {
  value: string;
  constructor(value = '') {
    this.value = value;
  }
  appendText(value: string): MarkdownString {
    this.value += value;
    return this;
  }
}

export enum CommentMode {
  Editing = 0,
  Preview = 1,
}

export const lm = {
  selectChatModels: async (_selector?: unknown): Promise<unknown[]> => [],
};

export const LanguageModelChatMessage = {
  User: (content: string) => ({ role: 'user', content }),
};

export class CancellationTokenSource {
  token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  cancel(): void {
    this.token.isCancellationRequested = true;
  }
  dispose(): void {}
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class ThemeIcon {
  constructor(public readonly id: string) {}
}

export class TreeItem {
  id?: string;
  description?: string;
  tooltip?: unknown;
  contextValue?: string;
  iconPath?: unknown;
  command?: { command: string; title: string; arguments?: unknown[] };
  constructor(
    public label: string,
    public collapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None,
  ) {}
}

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

export const workspace = {
  isTrusted: true,
  getConfiguration: (_section?: string) => ({
    get: <T>(_key: string, fallback?: T): T | undefined => fallback,
    inspect: <T>(_key: string): { globalValue?: T; defaultValue?: T } | undefined => undefined,
  }),
};
