import { describe, expect, it } from 'vitest';
import { extractOpenCodeText } from '../../ai/providers/openCodeOutput';

describe('extractOpenCodeText', () => {
  it('concatenates text events and ignores step events', () => {
    const stdout = [
      '{"type":"step_start","part":{"type":"step-start"}}',
      '{"type":"text","part":{"type":"text","text":"{\\"findings\\": "}}',
      '{"type":"text","part":{"type":"text","text":"[]}"}}',
      '{"type":"step_finish","part":{"type":"step-finish"}}',
    ].join('\n');

    const result = extractOpenCodeText(stdout);

    expect(result.text).toBe('{"findings": []}');
    expect(result.error).toBeUndefined();
  });

  it('surfaces error events', () => {
    const stdout = '{"type":"error","error":{"data":{"message":"Model not configured"}}}';
    expect(extractOpenCodeText(stdout).error).toBe('Model not configured');
  });

  it('skips non-JSON noise lines', () => {
    const stdout = 'some log line\n{"type":"text","part":{"text":"ok"}}\n';
    expect(extractOpenCodeText(stdout).text).toBe('ok');
  });
});
