import { structuredPatch, type Hunk } from 'diff';
import { FileDiff } from '../models/FileDiff';
import { ReviewFinding } from '../models/ReviewFinding';

/** A position that can be used to build an Azure DevOps thread context. */
export interface DiffPosition {
  filePath: string;
  rightFileStartLine?: number;
  rightFileEndLine?: number;
  leftFileStartLine?: number;
  leftFileEndLine?: number;
}

export interface MappingFailure {
  reason: string;
}

export function isMappingFailure(value: DiffPosition | MappingFailure): value is MappingFailure {
  return (value as MappingFailure).reason !== undefined;
}

const CONTEXT_LINES = 3;

/**
 * Maps an AI (or human) finding's line range to a position Azure DevOps can
 * anchor a comment thread to.
 *
 * Findings are expected to reference line numbers in the NEW file content,
 * except when the whole file was deleted (no new content exists), in which
 * case they reference the OLD file. We never trust the AI-provided number
 * blindly: the range must fall within the file's actual line count AND
 * within (or immediately adjacent to) a hunk the PR actually touched.
 */
export function mapFindingToDiffPosition(
  finding: ReviewFinding,
  diff: FileDiff,
): DiffPosition | MappingFailure {
  if (
    !Number.isInteger(finding.startLine) ||
    !Number.isInteger(finding.endLine) ||
    finding.startLine < 1 ||
    finding.endLine < finding.startLine
  ) {
    return { reason: `Invalid line range ${finding.startLine}-${finding.endLine}.` };
  }

  const isPureAdd = diff.oldContent === '' && diff.newContent !== '';
  const isPureDelete = diff.newContent === '' && diff.oldContent !== '';

  if (isPureDelete) {
    const oldLineCount = countLines(diff.oldContent);
    if (finding.endLine > oldLineCount) {
      return {
        reason: `Line ${finding.endLine} is beyond the deleted file's ${oldLineCount} lines.`,
      };
    }
    return {
      filePath: diff.path,
      leftFileStartLine: finding.startLine,
      leftFileEndLine: finding.endLine,
    };
  }

  if (isPureAdd) {
    const newLineCount = countLines(diff.newContent);
    if (finding.endLine > newLineCount) {
      return { reason: `Line ${finding.endLine} is beyond the new file's ${newLineCount} lines.` };
    }
    return {
      filePath: diff.path,
      rightFileStartLine: finding.startLine,
      rightFileEndLine: finding.endLine,
    };
  }

  const newLineCount = countLines(diff.newContent);
  if (finding.startLine > newLineCount) {
    return {
      reason: `Line ${finding.startLine} is beyond the file's ${newLineCount} lines; the AI may have hallucinated this location.`,
    };
  }

  const patch = structuredPatch(
    diff.originalPath ?? diff.path,
    diff.path,
    diff.oldContent,
    diff.newContent,
    '',
    '',
    { context: CONTEXT_LINES },
  );

  const hunk = patch.hunks.find((h) =>
    rangesOverlap(finding.startLine, finding.endLine, newRange(h)),
  );

  if (!hunk) {
    return {
      reason: 'The requested line range is not within or near any changed hunk for this file.',
    };
  }

  if (hunk.newLines === 0) {
    // The matched hunk is a pure deletion with no surviving new-file line to
    // anchor to. Findings on partial-file edits are expected to reference
    // new-file lines (see prompts/code-review.md); we don't guess here.
    return {
      reason: 'This line was removed and has no corresponding line in the new version of the file.',
    };
  }

  const [hunkStart, hunkEnd] = newRange(hunk);
  return {
    filePath: diff.path,
    rightFileStartLine: Math.max(finding.startLine, hunkStart),
    rightFileEndLine: Math.min(finding.endLine, hunkEnd),
  };
}

function newRange(hunk: Hunk): [number, number] {
  if (hunk.newLines === 0) {
    return [hunk.newStart, hunk.newStart];
  }
  return [hunk.newStart, hunk.newStart + hunk.newLines - 1];
}

function rangesOverlap(aStart: number, aEnd: number, [bStart, bEnd]: [number, number]): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

function countLines(content: string): number {
  if (content === '') {
    return 0;
  }
  return content.split('\n').length;
}
