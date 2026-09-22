import * as crypto from 'crypto';
import {
  AIReviewProvider,
  AIReviewResult,
  ReviewContext,
  ReviewOptions,
} from '../AIReviewProvider';
import { ReviewFinding } from '../../models/ReviewFinding';

/**
 * Deterministic provider used for automated tests and local UI development
 * (requirement #24) - never calls out to a real model.
 */
export class MockAIProvider implements AIReviewProvider {
  readonly id = 'mock';
  readonly name = 'Mock AI (offline)';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async review(context: ReviewContext, options: ReviewOptions): Promise<AIReviewResult> {
    const findings: ReviewFinding[] = [];

    for (const file of context.files) {
      if (findings.length >= options.maxFindings) {
        break;
      }
      if (file.additions === 0) {
        continue;
      }
      findings.push({
        id: crypto.randomUUID(),
        severity: 'medium',
        category: 'bug',
        title: 'Potential null access',
        description: `Deterministic mock finding for ${file.path}: verify that values used near the changed lines cannot be null/undefined at runtime.`,
        filePath: file.path,
        startLine: firstAddedLine(file.diff) ?? 1,
        endLine: firstAddedLine(file.diff) ?? 1,
        suggestedFix: 'Add a guard clause before dereferencing the value.',
        confidence: 0.8,
        provider: this.id,
        status: 'pending',
      });
    }

    return { findings, rejectedCount: 0 };
  }
}

function firstAddedLine(patch: string): number | undefined {
  const lines = patch.split('\n');
  let newLine = 0;
  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunkMatch) {
      newLine = parseInt(hunkMatch[1], 10) - 1;
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      return newLine + 1;
    }
    if (!line.startsWith('-')) {
      newLine++;
    }
  }
  return undefined;
}
