import { describe, expect, it } from 'vitest';
import { ReviewResultParser } from '../../ai/ReviewResultParser';

const baseOptions = {
  minConfidence: 0.5,
  maxFindings: 20,
  knownFilePaths: new Set(['src/app.ts']),
  providerId: 'mock',
};

describe('ReviewResultParser', () => {
  const parser = new ReviewResultParser();

  it('parses a valid JSON response', () => {
    const raw = JSON.stringify({
      findings: [
        {
          severity: 'high',
          category: 'bug',
          title: 'Bug',
          description: 'Something is wrong',
          filePath: 'src/app.ts',
          startLine: 10,
          endLine: 12,
          confidence: 0.9,
        },
      ],
    });

    const result = parser.parse(raw, baseOptions);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].status).toBe('pending');
    expect(result.rejectedCount).toBe(0);
  });

  it('rejects invalid JSON entirely', () => {
    const result = parser.parse('not json at all', baseOptions);
    expect(result.findings).toHaveLength(0);
    expect(result.rejectedCount).toBe(1);
  });

  it('rejects a response missing the findings array', () => {
    const result = parser.parse(JSON.stringify({ notFindings: [] }), baseOptions);
    expect(result.findings).toHaveLength(0);
  });

  it('rejects a finding with an invalid severity', () => {
    const raw = JSON.stringify({
      findings: [
        {
          severity: 'super-critical',
          category: 'bug',
          title: 'Bug',
          description: 'desc',
          filePath: 'src/app.ts',
          startLine: 1,
          endLine: 1,
          confidence: 0.9,
        },
      ],
    });
    const result = parser.parse(raw, baseOptions);
    expect(result.findings).toHaveLength(0);
    expect(result.rejectedCount).toBe(1);
  });

  it('rejects a finding pointing at an unknown file path (hallucination guard)', () => {
    const raw = JSON.stringify({
      findings: [
        {
          severity: 'high',
          category: 'bug',
          title: 'Bug',
          description: 'desc',
          filePath: 'src/does-not-exist.ts',
          startLine: 1,
          endLine: 1,
          confidence: 0.9,
        },
      ],
    });
    const result = parser.parse(raw, baseOptions);
    expect(result.findings).toHaveLength(0);
  });

  it('rejects a finding with an invalid line number', () => {
    const raw = JSON.stringify({
      findings: [
        {
          severity: 'high',
          category: 'bug',
          title: 'Bug',
          description: 'desc',
          filePath: 'src/app.ts',
          startLine: 5,
          endLine: 2,
          confidence: 0.9,
        },
      ],
    });
    const result = parser.parse(raw, baseOptions);
    expect(result.findings).toHaveLength(0);
  });

  it('filters findings below the minimum confidence', () => {
    const raw = JSON.stringify({
      findings: [
        {
          severity: 'low',
          category: 'style',
          title: 'Minor',
          description: 'desc',
          filePath: 'src/app.ts',
          startLine: 1,
          endLine: 1,
          confidence: 0.3,
        },
      ],
    });
    const result = parser.parse(raw, { ...baseOptions, minConfidence: 0.75 });
    expect(result.findings).toHaveLength(0);
    expect(result.rejectedCount).toBe(1);
  });

  it('caps findings at maxFindings, keeping the highest-confidence ones', () => {
    const findings = Array.from({ length: 5 }, (_, i) => ({
      severity: 'low',
      category: 'style',
      title: `Finding ${i}`,
      description: 'desc',
      filePath: 'src/app.ts',
      startLine: 1,
      endLine: 1,
      confidence: 0.6 + i * 0.05,
    }));
    const result = parser.parse(JSON.stringify({ findings }), { ...baseOptions, maxFindings: 2 });
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].confidence).toBeGreaterThan(result.findings[1].confidence);
  });

  it('strips a markdown code fence some models wrap JSON in', () => {
    const raw = '```json\n' + JSON.stringify({ findings: [] }) + '\n```';
    const result = parser.parse(raw, baseOptions);
    expect(result.findings).toHaveLength(0);
    expect(result.rejectedCount).toBe(0);
  });
});
