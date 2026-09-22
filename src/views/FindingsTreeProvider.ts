import * as vscode from 'vscode';
import { PullRequest } from '../models/PullRequest';
import { ReviewFinding, FindingSeverity } from '../models/ReviewFinding';
import { ReviewState } from '../review/ReviewState';

const SEVERITY_ICON: Record<FindingSeverity, string> = {
  critical: 'error',
  high: 'warning',
  medium: 'info',
  low: 'circle-outline',
  info: 'circle-outline',
};

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const STATUS_LABEL: Record<ReviewFinding['status'], string> = {
  pending: '',
  approved: '$(check) approved',
  rejected: '$(x) rejected',
  edited: '$(edit) edited',
  published: '$(cloud) published',
};

export class FindingItem extends vscode.TreeItem {
  constructor(
    public readonly finding: ReviewFinding,
    public readonly pullRequest: PullRequest,
  ) {
    super(finding.title, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'finding';
    this.id = finding.id;
    this.description = `${finding.filePath}:${finding.startLine}${STATUS_LABEL[finding.status] ? ' · ' + STATUS_LABEL[finding.status] : ''}`;
    this.iconPath = new vscode.ThemeIcon(SEVERITY_ICON[finding.severity]);
    this.tooltip = buildTooltip(finding);
    this.command = {
      command: 'azurePrReview.openChangedFile',
      title: 'Open Finding',
      arguments: [pullRequest, { path: finding.filePath }, finding.startLine],
    };
  }
}

export class SummaryItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'findingsSummary';
  }
}

type FindingsTreeElement = FindingItem | SummaryItem;

/** Displays AI review findings for the current PR, with approve/reject/edit affordances (requirement #26). */
export class FindingsTreeProvider implements vscode.TreeDataProvider<FindingsTreeElement> {
  private readonly emitter = new vscode.EventEmitter<FindingsTreeElement | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  private pullRequest: PullRequest | undefined;

  constructor(private readonly state: ReviewState) {
    this.state.onDidChange(() => this.emitter.fire());
  }

  setPullRequest(pr: PullRequest | undefined): void {
    this.pullRequest = pr;
    this.emitter.fire();
  }

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: FindingsTreeElement): vscode.TreeItem {
    return element;
  }

  getChildren(element?: FindingsTreeElement): FindingsTreeElement[] {
    if (element || !this.pullRequest) {
      return [];
    }
    const session = this.state.get(this.pullRequest.id);
    if (!session) {
      return [new SummaryItem('Run "Run AI Review" to generate findings.')];
    }
    if (session.status === 'running') {
      return [new SummaryItem('AI review in progress...')];
    }
    if (session.findings.length === 0) {
      return [
        new SummaryItem(
          session.status === 'failed' ? `Review failed: ${session.error}` : 'No findings.',
        ),
      ];
    }

    const pr = this.pullRequest;
    const sorted = [...session.findings].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );
    return [
      new SummaryItem(summaryLabel(session.findings)),
      ...sorted.map((f) => new FindingItem(f, pr)),
    ];
  }
}

function summaryLabel(findings: ReviewFinding[]): string {
  const counts: Record<FindingSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const f of findings) {
    counts[f.severity]++;
  }
  return `${findings.length} findings — Critical ${counts.critical}, High ${counts.high}, Medium ${counts.medium}, Low ${counts.low}`;
}

function buildTooltip(finding: ReviewFinding): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${finding.severity.toUpperCase()} · ${finding.category}**\n\n`);
  md.appendMarkdown(`${finding.description}\n\n`);
  if (finding.suggestedFix) {
    md.appendMarkdown(`_Suggested fix:_ ${finding.suggestedFix}\n\n`);
  }
  md.appendMarkdown(`Confidence: ${Math.round(finding.confidence * 100)}%`);
  if (finding.mappingError) {
    md.appendMarkdown(`\n\n⚠️ ${finding.mappingError}`);
  }
  return md;
}
