import { describe, expect, it } from 'vitest';
import { createBatches, dedupeFindings } from '../../ai/AIReviewOrchestrator';
import { ReviewFile } from '../../ai/AIReviewProvider';
import { ReviewFinding } from '../../models/ReviewFinding';

function reviewFile(path: string, diffLength = 100): ReviewFile {
  return {
    path,
    oldContent: '',
    newContent: 'x'.repeat(diffLength),
    diff: 'x'.repeat(diffLength),
    additions: 1,
    deletions: 0,
  };
}

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: Math.random().toString(36),
    severity: 'medium',
    category: 'bug',
    title: 'Duplicate title',
    description: 'desc',
    filePath: 'a.ts',
    startLine: 10,
    endLine: 12,
    confidence: 0.8,
    provider: 'mock',
    status: 'pending',
    ...overrides,
  };
}

describe('createBatches', () => {
  it('keeps small file sets in a single batch', () => {
    const batches = createBatches([reviewFile('a.ts'), reviewFile('b.ts')]);
    expect(batches).toHaveLength(1);
    expect(batches[0].files).toHaveLength(2);
  });

  it('splits large file counts into multiple batches (never one enormous prompt)', () => {
    const files = Array.from({ length: 20 }, (_, i) => reviewFile(`file-${i}.ts`));
    const batches = createBatches(files);
    expect(batches.length).toBeGreaterThan(1);
    const totalFiles = batches.reduce((sum, b) => sum + b.files.length, 0);
    expect(totalFiles).toBe(20);
  });

  it('splits when the estimated token budget would be exceeded even with few files', () => {
    const files = [reviewFile('huge1.ts', 50_000), reviewFile('huge2.ts', 50_000)];
    const batches = createBatches(files);
    expect(batches.length).toBeGreaterThan(1);
  });

  it('returns a single empty batch for no files', () => {
    const batches = createBatches([]);
    expect(batches).toHaveLength(1);
    expect(batches[0].files).toHaveLength(0);
  });
});

describe('dedupeFindings', () => {
  it('merges findings with the same file, overlapping lines, and matching title', () => {
    const findings = [
      finding({ startLine: 10, endLine: 12 }),
      finding({ startLine: 11, endLine: 13, title: 'DUPLICATE TITLE' }),
    ];
    const result = dedupeFindings(findings);
    expect(result).toHaveLength(1);
  });

  it('keeps findings in different files distinct', () => {
    const findings = [finding({ filePath: 'a.ts' }), finding({ filePath: 'b.ts' })];
    expect(dedupeFindings(findings)).toHaveLength(2);
  });

  it('keeps non-overlapping line ranges distinct even with the same title', () => {
    const findings = [
      finding({ startLine: 1, endLine: 2 }),
      finding({ startLine: 50, endLine: 51 }),
    ];
    expect(dedupeFindings(findings)).toHaveLength(2);
  });
});
