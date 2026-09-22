import * as vscode from 'vscode';
import { LogLevel } from '../config/Configuration';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Writes to the "Azure PR Review" Output channel.
 *
 * Never pass PATs, tokens, API keys, full source code, prompts containing
 * secrets, or customer PII to this logger - see requirement #32.
 */
export class Logger {
  private static instance: Logger | undefined;
  private readonly channel: vscode.OutputChannel;
  private level: LogLevel = 'info';

  private constructor() {
    this.channel = vscode.window.createOutputChannel('Azure PR Review');
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(message: string, ...meta: unknown[]): void {
    this.write('debug', message, meta);
  }

  info(message: string, ...meta: unknown[]): void {
    this.write('info', message, meta);
  }

  warn(message: string, ...meta: unknown[]): void {
    this.write('warn', message, meta);
  }

  error(message: string, error?: unknown): void {
    const details = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : error;
    this.write('error', message, details === undefined ? [] : [details]);
  }

  show(): void {
    this.channel.show(true);
  }

  private write(level: LogLevel, message: string, meta: unknown[]): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) {
      return;
    }
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    const suffix = meta.length > 0 ? ' ' + meta.map((m) => safeStringify(m)).join(' ') : '';
    this.channel.appendLine(`${prefix} ${message}${suffix}`);
  }
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
