import { describe, expect, it } from 'vitest';
import { mapFindingToDiffPosition, isMappingFailure } from '../../utils/lineMapping';
import { FileDiff } from '../../models/FileDiff';
import { ReviewFinding } from '../../models/ReviewFinding';

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: '1',
    severity: 'medium',
    category: 'bug',
    title: 'test',
    description: 'test',
    filePath: 'a.ts',
    startLine: 1,
    endLine: 1,
    confidence: 0.9,
    provider: 'mock',
    status: 'pending',
    ...overrides,
  };
}

describe('mapFindingToDiffPosition', () => {
  it('maps a finding on an added line to the right file', () => {
    const oldContent = 'line1\nline2\nline3\n';
    const newContent = 'line1\nline2\nADDED\nline3\n';
    const diff: FileDiff = { path: 'a.ts', oldContent, newContent, additions: 1, deletions: 0 };

    const result = mapFindingToDiffPosition(finding({ startLine: 3, endLine: 3 }), diff);

    expect(isMappingFailure(result)).toBe(false);
    if (!isMappingFailure(result)) {
      expect(result.rightFileStartLine).toBe(3);
      expect(result.rightFileEndLine).toBe(3);
    }
  });

  it('maps a finding on a context line adjacent to a mid-file deletion using new-file numbering', () => {
    const oldContent = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n';
    const newContent = 'a\nb\nc\nd\nf\ng\nh\ni\nj\n'; // "e" removed
    const diff: FileDiff = { path: 'a.ts', oldContent, newContent, additions: 0, deletions: 1 };

    // New-file line 5 is "f", immediately after the deletion - within the hunk's context.
    const result = mapFindingToDiffPosition(finding({ startLine: 5, endLine: 5 }), diff);

    expect(isMappingFailure(result)).toBe(false);
    if (!isMappingFailure(result)) {
      expect(result.rightFileStartLine).toBe(5);
    }
  });

  it('rejects a finding whose line is far outside the file', () => {
    const diff: FileDiff = {
      path: 'a.ts',
      oldContent: 'a\nb\n',
      newContent: 'a\nb\nc\n',
      additions: 1,
      deletions: 0,
    };

    const result = mapFindingToDiffPosition(finding({ startLine: 500, endLine: 500 }), diff);

    expect(isMappingFailure(result)).toBe(true);
  });

  it('rejects a finding pointing at an unchanged region far from any hunk', () => {
    const oldContent = Array.from({ length: 50 }, (_, i) => `unchanged-${i}`).join('\n') + '\n';
    const newContent = oldContent.replace('unchanged-0', 'CHANGED-0');

    const diff: FileDiff = { path: 'a.ts', oldContent, newContent, additions: 1, deletions: 1 };

    // Line 40 is far from the single hunk near line 1.
    const result = mapFindingToDiffPosition(finding({ startLine: 40, endLine: 40 }), diff);

    expect(isMappingFailure(result)).toBe(true);
  });

  it('maps a fully added file using the new content line numbers', () => {
    const diff: FileDiff = {
      path: 'new.ts',
      oldContent: '',
      newContent: 'a\nb\nc\n',
      additions: 3,
      deletions: 0,
    };

    const result = mapFindingToDiffPosition(finding({ startLine: 2, endLine: 2 }), diff);

    expect(isMappingFailure(result)).toBe(false);
    if (!isMappingFailure(result)) {
      expect(result.rightFileStartLine).toBe(2);
    }
  });

  it('maps a fully deleted file using the old content line numbers', () => {
    const diff: FileDiff = {
      path: 'gone.ts',
      oldContent: 'a\nb\nc\n',
      newContent: '',
      additions: 0,
      deletions: 3,
    };

    const result = mapFindingToDiffPosition(finding({ startLine: 1, endLine: 2 }), diff);

    expect(isMappingFailure(result)).toBe(false);
    if (!isMappingFailure(result)) {
      expect(result.leftFileStartLine).toBe(1);
      expect(result.leftFileEndLine).toBe(2);
    }
  });

  it('rejects an invalid line range', () => {
    const diff: FileDiff = {
      path: 'a.ts',
      oldContent: 'a\n',
      newContent: 'a\nb\n',
      additions: 1,
      deletions: 0,
    };
    const result = mapFindingToDiffPosition(finding({ startLine: 2, endLine: 1 }), diff);
    expect(isMappingFailure(result)).toBe(true);
  });
});
