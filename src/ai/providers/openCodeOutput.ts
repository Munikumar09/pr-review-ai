/**
 * `opencode run --format json` emits newline-delimited JSON events. The
 * model's answer is carried in `{"type":"text","part":{"text":"..."}}`
 * events; errors arrive as `{"type":"error",...}`.
 */
export interface OpenCodeExtraction {
  text: string;
  error?: string;
}

export function extractOpenCodeText(stdout: string): OpenCodeExtraction {
  let text = '';
  let error: string | undefined;

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) {
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof event !== 'object' || event === null) {
      continue;
    }
    const {
      type,
      part,
      error: eventError,
    } = event as {
      type?: unknown;
      part?: { text?: unknown };
      error?: { message?: unknown; data?: { message?: unknown } };
    };

    if (type === 'text' && typeof part?.text === 'string') {
      text += part.text;
    } else if (type === 'error') {
      const message = eventError?.data?.message ?? eventError?.message;
      error = typeof message === 'string' ? message : 'OpenCode reported an error.';
    }
  }

  return { text, error };
}
