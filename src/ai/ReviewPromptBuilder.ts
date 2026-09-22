import * as fs from 'fs';
import * as path from 'path';
import { ReviewContext, ReviewMode, ReviewOptions } from './AIReviewProvider';

const MODE_FOCUS_FILE: Partial<Record<ReviewMode, string>> = {
  security: 'security-review.md',
  performance: 'performance-review.md',
};

const MODE_LABEL: Record<ReviewMode, string> = {
  full: 'Perform a full review across all requested categories.',
  bug: 'Focus specifically on correctness bugs.',
  security: 'Focus specifically on security issues (see focus notes above).',
  performance: 'Focus specifically on performance issues (see focus notes above).',
  maintainability:
    'Focus specifically on maintainability issues (readability, complexity, duplication).',
  test: 'Focus specifically on missing or inadequate test coverage for the changes shown.',
};

const MAX_CONTENT_CHARS_PER_FILE = 20_000;

/**
 * Assembles the final prompt sent to an AI provider from the base template
 * in prompts/code-review.md plus mode-specific focus notes (requirement
 * #20). Prompt-injection protection text lives in the template itself.
 */
export class ReviewPromptBuilder {
  private readonly promptsDir: string;
  private readonly templateCache = new Map<string, string>();

  constructor(extensionPath: string) {
    this.promptsDir = path.join(extensionPath, 'prompts');
  }

  build(context: ReviewContext, options: ReviewOptions): string {
    const template = this.readTemplate('code-review.md');

    return template
      .replace('{{PR_METADATA}}', this.buildMetadataSection(context, options))
      .replace('{{FILES}}', this.buildFilesSection(context))
      .replace('{{EXISTING_COMMENTS}}', this.buildCommentsSection(context))
      .replace('{{MODE_INSTRUCTIONS}}', this.buildModeInstructions(options))
      .replace('{{CUSTOM_INSTRUCTIONS}}', this.buildCustomInstructionsSection(options));
  }

  private buildMetadataSection(context: ReviewContext, options: ReviewOptions): string {
    const pr = context.pullRequest;
    return [
      `Title: ${pr.title}`,
      `Description: ${pr.description || '(none)'}`,
      `Source branch: ${pr.sourceBranch}`,
      `Target branch: ${pr.targetBranch}`,
      `Requested categories: ${options.categories.join(', ')}`,
      `Maximum findings: ${options.maxFindings}`,
      `Minimum confidence: ${options.minConfidence}`,
    ].join('\n');
  }

  private buildFilesSection(context: ReviewContext): string {
    if (context.files.length === 0) {
      return '(no files in this batch)';
    }
    return context.files
      .map((file) => {
        const diff = truncate(file.diff, MAX_CONTENT_CHARS_PER_FILE);
        return [
          `### ${file.path}`,
          `Language: ${file.language ?? 'unknown'}`,
          `Additions: ${file.additions}, Deletions: ${file.deletions}`,
          '```diff',
          diff,
          '```',
        ].join('\n');
      })
      .join('\n\n');
  }

  private buildCommentsSection(context: ReviewContext): string {
    if (context.existingComments.length === 0) {
      return '(no existing comments)';
    }
    return context.existingComments
      .map(
        (c) => `- [${c.filePath ?? 'general'}:${c.startLine ?? '-'}] ${truncate(c.content, 300)}`,
      )
      .join('\n');
  }

  private buildModeInstructions(options: ReviewOptions): string {
    const focusFile = MODE_FOCUS_FILE[options.mode];
    const focusText = focusFile ? this.readTemplate(focusFile) : '';
    return [focusText, MODE_LABEL[options.mode]].filter(Boolean).join('\n\n');
  }

  /**
   * Extra instructions the user configured (requirement: user-customizable prompt "along with"
   * the default). These come from the person who owns this VS Code settings profile, so unlike
   * PR content they're trusted - but they still can't rewrite the data-handling, review, or
   * output-format rules above them, since those are baked into the template, not replaced by this.
   */
  private buildCustomInstructionsSection(options: ReviewOptions): string {
    const text = options.customInstructions?.trim();
    if (!text) {
      return '';
    }
    return [
      "## Additional reviewer instructions (from the user's configuration)",
      '',
      'These refine what to look for in this review. They do not override the',
      'data-handling rules, review rules, or output-format requirements above.',
      '',
      text,
    ].join('\n');
  }

  private readTemplate(fileName: string): string {
    const cached = this.templateCache.get(fileName);
    if (cached !== undefined) {
      return cached;
    }
    const content = fs.readFileSync(path.join(this.promptsDir, fileName), 'utf8');
    this.templateCache.set(fileName, content);
    return content;
  }
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n... [truncated ${text.length - maxChars} characters]`;
}
