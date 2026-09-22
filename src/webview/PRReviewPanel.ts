import * as vscode from 'vscode';
import { PullRequest } from '../models/PullRequest';
import { PullRequestFile } from '../models/PullRequestFile';
import { ReviewSession } from '../models/ReviewSession';
import { ReviewFinding, FindingSeverity } from '../models/ReviewFinding';
import { PublishSummary } from '../review/ApprovalManager';

export interface PanelViewModel {
  pullRequest: PullRequest;
  files: PullRequestFile[];
  session?: ReviewSession;
  summary?: PublishSummary;
}

export type PanelMessage =
  | { type: 'reviewPullRequest' }
  | { type: 'refresh' }
  | { type: 'openInBrowser' }
  | { type: 'cancelReview' }
  | { type: 'clearReview' }
  | { type: 'approve'; findingId: string }
  | { type: 'remove'; findingId: string }
  | { type: 'editFinding'; findingId: string }
  | { type: 'fix'; findingId: string }
  | { type: 'openFinding'; findingId: string }
  | { type: 'approveAll' }
  | { type: 'publishApproved' };

/**
 * Pure UI layer: renders the PR dashboard + findings list and forwards user
 * actions as typed messages. Holds no Azure DevOps or AI logic
 * (requirement #2.2) - ReviewPanelProvider owns that.
 */
export class PRReviewPanel {
  static readonly viewType = 'azurePrReview.reviewPanel';
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly messageEmitter = new vscode.EventEmitter<PanelMessage>();
  readonly onDidReceiveMessage = this.messageEmitter.event;
  private readonly disposeEmitter = new vscode.EventEmitter<void>();
  readonly onDidDispose = this.disposeEmitter.event;

  constructor(pullRequest: PullRequest) {
    this.panel = vscode.window.createWebviewPanel(
      PRReviewPanel.viewType,
      `PR #${pullRequest.id}: ${pullRequest.title}`,
      { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message: PanelMessage) =>
        this.messageEmitter.fire(message),
      ),
      this.panel.onDidDispose(() => this.disposeEmitter.fire()),
    );
  }

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.One, false);
  }

  update(model: PanelViewModel): void {
    this.panel.title = `PR #${model.pullRequest.id}: ${model.pullRequest.title}`;
    this.panel.webview.html = render(model);
  }

  dispose(): void {
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

function render(model: PanelViewModel): string {
  const { pullRequest: pr, files, session, summary } = model;
  const totals = files.reduce(
    (acc, f) => ({
      additions: acc.additions + f.additions,
      deletions: acc.deletions + f.deletions,
    }),
    { additions: 0, deletions: 0 },
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 16px 24px; }
  h1 { font-size: 1.3em; }
  .meta-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px 24px; margin: 12px 0 20px; }
  .meta-grid div span.label { display:block; opacity: 0.7; font-size: 0.8em; text-transform: uppercase; }
  .actions button { margin-right: 8px; margin-bottom: 12px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; border-radius: 2px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }
  .card { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 12px; margin-bottom: 10px; }
  .card .title { font-weight: 600; }
  .sev-critical { color: var(--vscode-errorForeground); }
  .sev-high { color: var(--vscode-editorWarning-foreground); }
  .badge { display:inline-block; padding: 1px 6px; border-radius: 8px; font-size: 0.75em; margin-left: 6px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .publish-bar { position: sticky; bottom: 0; background: var(--vscode-editor-background); border-top: 1px solid var(--vscode-panel-border); padding: 10px 0; margin-top: 16px; }
  .status-pending { opacity: 0.6; font-style: italic; }
</style>
</head>
<body>
  <h1>PR #${pr.id}: ${escapeHtml(pr.title)}</h1>
  <div class="meta-grid">
    <div><span class="label">Repository</span>${escapeHtml(pr.repositoryName)}</div>
    <div><span class="label">Source</span>${escapeHtml(pr.sourceBranch)}</div>
    <div><span class="label">Target</span>${escapeHtml(pr.targetBranch)}</div>
    <div><span class="label">Author</span>${escapeHtml(pr.createdBy)}</div>
    <div><span class="label">Files</span>${files.length}</div>
    <div><span class="label">Additions</span>+${totals.additions}</div>
    <div><span class="label">Deletions</span>-${totals.deletions}</div>
    <div><span class="label">Status</span>${pr.status}</div>
  </div>
  <div class="actions">
    <button onclick="send('reviewPullRequest')">Run AI Review</button>
    <button class="secondary" onclick="send('refresh')">Refresh</button>
    <button class="secondary" onclick="send('openInBrowser')">Open in Azure DevOps</button>
    ${session?.status === 'running' ? '<button class="secondary" onclick="send(\'cancelReview\')">Cancel Review</button>' : ''}
    ${hasApprovableFindings(session) ? '<button onclick="send(\'approveAll\')">Approve All</button>' : ''}
    ${session && session.status !== 'running' ? '<button class="secondary" onclick="send(\'clearReview\')">Clear All</button>' : ''}
  </div>
  ${renderFindings(session)}
  ${renderPublishBar(summary)}
  <script>
    const vscode = acquireVsCodeApi();
    function send(type, extra) { vscode.postMessage(Object.assign({ type }, extra || {})); }
  </script>
</body>
</html>`;
}

function hasApprovableFindings(session?: ReviewSession): boolean {
  return (
    session?.status !== 'running' &&
    (session?.findings.some((f) => f.status === 'pending' || f.status === 'edited') ?? false)
  );
}

function renderFindings(session?: ReviewSession): string {
  if (!session) {
    return '<p class="status-pending">No AI review has been run yet for this pull request.</p>';
  }
  if (session.status === 'running') {
    return '<p>Reviewing pull request... this may take a moment.</p>';
  }
  if (session.status === 'failed') {
    return `<p>AI review failed: ${escapeHtml(session.error ?? 'Unknown error')}</p>`;
  }
  if (session.findings.length === 0) {
    return '<p>The AI review found no findings meeting the confidence threshold.</p>';
  }

  const counts = countBySeverity(session.findings);
  const summaryLine = `<p><strong>${session.findings.length} findings</strong> — Critical ${counts.critical}, High ${counts.high}, Medium ${counts.medium}, Low ${counts.low}</p>`;

  const cards = session.findings
    .map(
      (f) => `<div class="card">
        <div class="title sev-${f.severity}">${severityBadge(f.severity)} ${escapeHtml(f.title)} <span class="badge">${f.status}</span></div>
        <div>${escapeHtml(f.filePath)}:${f.startLine}-${f.endLine}</div>
        <p>${escapeHtml(f.description)}</p>
        ${f.suggestedFix ? `<p><em>Suggested fix:</em> ${escapeHtml(f.suggestedFix)}</p>` : ''}
        <p>Confidence: ${Math.round(f.confidence * 100)}%${f.mappingError ? ` · ⚠ ${escapeHtml(f.mappingError)}` : ''}</p>
        <button onclick="send('openFinding', { findingId: '${f.id}' })">Open</button>
        <button ${f.status === 'published' ? 'disabled' : ''} onclick="send('approve', { findingId: '${f.id}' })" title="Approve and publish this as a comment on the pull request now">Approve</button>
        <button class="secondary" onclick="send('editFinding', { findingId: '${f.id}' })">Edit</button>
        <button class="secondary" onclick="send('fix', { findingId: '${f.id}' })" title="Jump to the flagged code and show the suggested fix - never edits your files automatically">Fix</button>
        <button class="secondary" onclick="send('remove', { findingId: '${f.id}' })" title="Remove this finding from the list - does not affect Azure DevOps">Remove</button>
      </div>`,
    )
    .join('\n');

  return summaryLine + cards;
}

function renderPublishBar(summary?: PublishSummary): string {
  if (!summary) {
    return '';
  }
  return `<div class="publish-bar">
    <p>Approved: ${summary.approved} &nbsp; Rejected: ${summary.rejected} &nbsp; Pending: ${summary.pending} &nbsp; Ready to publish: ${summary.readyToPublish}</p>
    <button ${summary.readyToPublish === 0 ? 'disabled' : ''} onclick="send('publishApproved')">Publish ${summary.readyToPublish} Comments</button>
  </div>`;
}

function countBySeverity(findings: ReviewFinding[]): Record<FindingSeverity, number> {
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
  return counts;
}

function severityBadge(severity: FindingSeverity): string {
  const icons: Record<FindingSeverity, string> = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🔵',
    info: '⚪',
  };
  return `${icons[severity]} ${severity.toUpperCase()}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
