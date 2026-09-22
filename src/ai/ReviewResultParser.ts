import * as crypto from 'crypto';
import { AIReviewResult } from './AIReviewProvider';
import { FindingCategory, FindingSeverity, ReviewFinding } from '../models/ReviewFinding';
import { Logger } from '../utils/logger';
import { MAX_AI_RESPONSE_BYTES } from '../utils/securityLimits';

const VALID_SEVERITIES: FindingSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
const VALID_CATEGORIES: FindingCategory[] = [
  'bug',
  'security',
  'performance',
  'maintainability',
  'testing',
  'style',
  'other',
];

interface RawFinding {
  severity?: unknown;
  category?: unknown;
  title?: unknown;
  description?: unknown;
  filePath?: unknown;
  startLine?: unknown;
  endLine?: unknown;
  suggestedFix?: unknown;
  confidence?: unknown;
}

export interface ParseOptions {
  minConfidence: number;
  maxFindings: number;
  knownFilePaths: Set<string>;
  providerId: string;
}

/**
 * Validates AI provider output against the strict JSON contract
 * (requirement #18/#20). Malformed findings are dropped, never published;
 * we never fall back to free-form Markdown parsing.
 */
export class ReviewResultParser {
  private readonly logger = Logger.getInstance();

  parse(raw: string, options: ParseOptions): AIReviewResult {
    if (Buffer.byteLength(raw, 'utf8') > MAX_AI_RESPONSE_BYTES) {
      return { findings: [], rejectedCount: 1 };
    }
    const jsonText = extractJson(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      this.logger.warn('AI response was not valid JSON; rejecting the entire response.');
      return { findings: [], rejectedCount: 1, raw };
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as { findings?: unknown }).findings)
    ) {
      this.logger.warn('AI response JSON did not contain a "findings" array.');
      return { findings: [], rejectedCount: 1, raw };
    }

    const rawFindings = (parsed as { findings: RawFinding[] }).findings;
    const findings: ReviewFinding[] = [];
    let rejectedCount = 0;

    for (const rawFinding of rawFindings) {
      const finding = this.validate(rawFinding, options);
      if (finding) {
        findings.push(finding);
      } else {
        rejectedCount++;
      }
    }

    const confident = findings.filter((f) => f.confidence >= options.minConfidence);
    rejectedCount += findings.length - confident.length;

    const sorted = confident.sort((a, b) => b.confidence - a.confidence);
    const capped = sorted.slice(0, options.maxFindings);
    rejectedCount += sorted.length - capped.length;

    return { findings: capped, rejectedCount, raw };
  }

  private validate(value: unknown, options: ParseOptions): ReviewFinding | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const raw = value as RawFinding;
    if (!isValidSeverity(raw.severity)) {
      this.logger.debug('Rejected finding: invalid severity');
      return undefined;
    }
    if (!isValidCategory(raw.category)) {
      this.logger.debug('Rejected finding: invalid category');
      return undefined;
    }
    if (typeof raw.title !== 'string' || raw.title.trim().length === 0 || raw.title.length > 500) {
      this.logger.debug('Rejected finding: missing title');
      return undefined;
    }
    if (
      typeof raw.description !== 'string' ||
      raw.description.trim().length === 0 ||
      raw.description.length > 20_000
    ) {
      this.logger.debug('Rejected finding: missing description');
      return undefined;
    }
    if (
      typeof raw.filePath !== 'string' ||
      !options.knownFilePaths.has(normalizePath(raw.filePath))
    ) {
      this.logger.debug('Rejected finding: unknown filePath');
      return undefined;
    }
    if (!Number.isSafeInteger(raw.startLine) || (raw.startLine as number) < 1) {
      this.logger.debug('Rejected finding: invalid startLine');
      return undefined;
    }
    if (!Number.isSafeInteger(raw.endLine) || (raw.endLine as number) < (raw.startLine as number)) {
      this.logger.debug('Rejected finding: invalid endLine');
      return undefined;
    }
    if (
      typeof raw.confidence !== 'number' ||
      Number.isNaN(raw.confidence) ||
      raw.confidence < 0 ||
      raw.confidence > 1
    ) {
      this.logger.debug('Rejected finding: invalid confidence');
      return undefined;
    }
    if (
      raw.suggestedFix !== undefined &&
      (typeof raw.suggestedFix !== 'string' || raw.suggestedFix.length > 20_000)
    ) {
      this.logger.debug('Rejected finding: invalid suggestedFix type');
      return undefined;
    }

    return {
      id: crypto.randomUUID(),
      severity: raw.severity,
      category: raw.category,
      title: raw.title.trim(),
      description: raw.description.trim(),
      filePath: normalizePath(raw.filePath),
      startLine: raw.startLine as number,
      endLine: raw.endLine as number,
      suggestedFix: raw.suggestedFix?.trim() || undefined,
      confidence: raw.confidence,
      provider: options.providerId,
      status: 'pending',
    };
  }
}

function isValidSeverity(value: unknown): value is FindingSeverity {
  return typeof value === 'string' && (VALID_SEVERITIES as string[]).includes(value);
}

function isValidCategory(value: unknown): value is FindingCategory {
  return typeof value === 'string' && (VALID_CATEGORIES as string[]).includes(value);
}

function normalizePath(path: string): string {
  return path.trim().replace(/^\.?\//, '');
}

/** Strips markdown code fences some models wrap JSON in, despite instructions not to. */
function extractJson(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  return raw.trim();
}
