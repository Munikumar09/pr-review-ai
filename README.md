# Azure DevOps AI PR Review

Review Azure DevOps pull requests without leaving VS Code — browse PRs, view
diffs with the native diff editor, read and add comments, and optionally run
an AI-assisted review whose findings must be explicitly approved by a human
before anything is published back to Azure DevOps.

> Screenshot placeholders: `media/screenshot-pr-list.png`,
> `media/screenshot-diff.png`, `media/screenshot-findings.png` (add real
> captures here before publishing).

## Features

- Connect to Azure DevOps with a Personal Access Token (stored in VS Code
  SecretStorage, never in settings or on disk).
- Browse **My Pull Requests**, **Assigned To Me**, and **All Open PRs**.
- View PR metadata (branches, author, file/line counts) and open it in the
  browser.
- Browse changed files as a folder/file tree with additions/deletions and
  change type.
- Open any changed file in VS Code's **native diff editor** — works even if
  the PR branch isn't checked out locally.
- Read existing Azure DevOps PR comment threads, grouped by file.
- Add review comments directly on a diff line (via VS Code's built-in
  Comments UI, or from the file context menu) — these become real Azure
  DevOps PR threads.
- Run an AI review of an entire PR, selected files, or the current file,
  with selectable review modes (Full/Bug/Security/Performance/
  Maintainability/Test).
- AI findings are shown with severity, confidence, and a suggested fix. They
  are **never** published automatically — you must Approve (or Edit) each
  one, then explicitly click **Publish Approved Comments**.
- Duplicate detection avoids re-posting a comment that already exists on the
  PR.
- Secret-detection warning before PR content is sent to an AI provider.
- Large-PR safeguards: above ~100 files or ~10k changed lines, you're asked
  to narrow the review scope instead of reviewing everything at once.

## Architecture

```
src/
├── extension.ts          entry point: wiring only
├── commands/              command handlers (thin, delegate to managers)
├── azure/                 Azure DevOps REST integration + normalization
├── ai/                    AI provider abstraction + review pipeline
│   └── providers/         Mock, OpenCode, Copilot (vscode.lm)
├── review/                review session state, approval, publishing gate
├── diff/                  native VS Code diff wiring, file-tree builder
├── views/                 TreeDataProviders (UI only, no API calls)
├── webview/                PR dashboard + findings panel
├── models/                 normalized domain types
├── config/                 typed Configuration wrapper
├── storage/                in-memory cache + review session persistence
└── utils/                  logger, errors, line mapping, secret detection
```

Azure DevOps and AI providers never reference each other directly — both
sides only exchange normalized models (`PullRequest`, `ReviewFinding`,
`ReviewContext`, ...). This means a new AI provider or a future Azure
DevOps auth method (OAuth/Entra ID) can be added without touching the other
side.

```
                    Application Core (review/, ai/AIReviewOrchestrator)
                          │
             ┌────────────┴────────────┐
             │                         │
      Azure DevOps                  AI Review
      (azure/*Service)              (AIReviewProvider)
             │                         │
             ▼                         ▼
      AzureDevOpsClient        Mock / OpenCode / Copilot
```

## Requirements

- VS Code 1.85+
- Node.js 18+ (for building from source)
- An Azure DevOps organization, project, and Git repository you have access to
- A Personal Access Token with **Code (Read & Write)** and **Pull Request**
  scopes
- Optional: the [OpenCode](https://opencode.ai) CLI on your `PATH` for the
  OpenCode AI provider
- Optional: GitHub Copilot Chat installed and signed in, for the Copilot
  provider (uses the supported `vscode.lm` Language Model API)

## Installation

### From source (VSIX)

```bash
npm install
npm run package        # produces azure-pr-review-<version>.vsix
```

In VS Code: **Extensions view → "..." menu → Install from VSIX...** and
select the generated file.

### For development

```bash
npm install
npm run compile
```

Then press `F5` in VS Code (uses `.vscode/launch.json`) to launch an
Extension Development Host with the extension loaded.

## Azure DevOps setup

1. In Azure DevOps, go to **User Settings → Personal Access Tokens** and
   create a token with **Code (Read & Write)** scope (this covers Pull
   Request read/write).
2. Run **Azure PR Review: Configure Azure DevOps** from the Command Palette
   and enter your organization, project, and repository names.
3. Run **Azure PR Review: Sign In** and paste the token when prompted.

## Authentication

The current implementation uses a Personal Access Token, stored exclusively
via VS Code's `SecretStorage` API — it is never written to `settings.json`,
workspace files, `.env` files, source code, or logs.

Authentication is defined behind the `AzureDevOpsAuthProvider` interface
(`src/azure/AzureDevOpsAuth.ts`), so an OAuth/Microsoft Entra ID flow can be
added later without changing `AzureDevOpsClient` or anything above it.

## OpenCode setup

1. Install the OpenCode CLI so it's available on your `PATH` (or set
   `azurePrReview.opencode.command` to its full path).
2. Set `azurePrReview.ai.provider` to `"opencode"`.
3. Run **Azure PR Review: Run AI Review**. The extension checks
   `<command> --version` first and shows a clear error if OpenCode isn't
   found, rather than failing silently.

The OpenCode provider (`src/ai/providers/OpenCodeProvider.ts`) invokes the
CLI as a child process, feeding it the review prompt over stdin and reading
structured JSON from stdout. It enforces a timeout, supports cancellation,
never logs prompt/response content (which may contain proprietary source),
and surfaces non-zero exit codes as user-facing errors.

**Note on the CLI contract:** this implementation assumes OpenCode exposes
`opencode run --json` accepting a prompt on stdin and returning JSON on
stdout, matching the "machine-readable/API mode" the requirements call for.
If your installed OpenCode version uses a different invocation, adjust the
`args` passed to `run()` in `OpenCodeProvider.ts` accordingly — the rest of
the pipeline (context building, parsing, validation, line mapping) is
unaffected by that detail.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `azurePrReview.organization` | `""` | Azure DevOps organization |
| `azurePrReview.project` | `""` | Azure DevOps project |
| `azurePrReview.repository` | `""` | Azure DevOps repository |
| `azurePrReview.ai.provider` | `"mock"` | `mock` \| `opencode` \| `copilot` |
| `azurePrReview.ai.maxFindings` | `20` | Cap on findings kept per review |
| `azurePrReview.ai.minConfidence` | `0.75` | Minimum confidence (0-1) to keep a finding |
| `azurePrReview.ai.reviewCategories` | bug/security/performance/maintainability/testing | Categories the AI should focus on |
| `azurePrReview.opencode.command` | `"opencode"` | Executable used for the OpenCode provider |
| `azurePrReview.logging.level` | `"info"` | Output channel verbosity |
| `azurePrReview.security.secretDetection` | `true` | Warn before sending content that looks like a secret to an AI provider |

## Usage

1. Open the **Azure PR Review** icon in the Activity Bar.
2. Expand **My Pull Requests** / **Assigned To Me** / **All Open PRs** and
   click a PR to open it.
3. Use the **Changed Files** view to browse the diff tree; click a file to
   open it in the native diff editor.
4. To comment: click the **+** that appears next to a line in the diff
   editor (native VS Code Comments UI), or right-click a file in the tree
   and choose **Add Comment**.
5. Check the **Comments** view for existing threads; click one to jump to
   its file/line.

## AI review workflow

1. Right-click a PR (or use the PR panel) → **Run AI Review**, or use
   **AI Review Current File** from a file's context menu.
2. For large PRs you'll be asked to choose a scope (entire PR vs. selected
   files) before anything is sent to the AI provider.
3. If likely secrets are detected in the diff content, you'll be asked to
   confirm before continuing.
4. Pick a review mode (Full/Bug/Security/Performance/Maintainability/Test).
5. Progress is shown in a cancellable notification. Findings appear in the
   **Review Findings** view and the PR panel, grouped by severity.
6. For each finding: **Open** jumps to the exact file/line, **Approve** /
   **Reject** / **Edit** change its status. Nothing is sent to Azure DevOps
   yet at this point.
7. Click **Publish Approved Comments** to see a final summary (approved /
   rejected / pending / ready-to-publish counts) and confirm. Only then are
   Azure DevOps threads actually created — duplicates and findings that
   couldn't be safely mapped to a line are skipped and reported.

## Security considerations

- PR content is treated as **untrusted data**: the AI prompt explicitly
  instructs the model to never follow instructions embedded in repository
  content and to never reveal credentials/secrets, even if content in the PR
  asks it to (see `prompts/code-review.md`).
- The extension never executes code from the PR (no automatic
  `npm install`, `pip install`, `make`, test runs, etc.).
- AI line numbers are never trusted blindly — `src/utils/lineMapping.ts`
  validates every finding against the PR's actual diff hunks before it can
  be published; unmappable findings are blocked with a clear message.
- A best-effort secret scanner (`src/utils/secretDetection.ts`) flags
  API keys, private keys, bearer tokens, AWS keys, connection strings, and
  similar patterns before content leaves VS Code for an AI provider. This is
  a warning, not a guarantee.
- Nothing is ever published to Azure DevOps without an explicit human
  Approve + Publish action.

## Development

```bash
npm install
npm run watch     # esbuild in watch mode
```

Press `F5` to launch the Extension Development Host.

Project conventions:

- TypeScript `strict: true`; avoid `any`.
- Azure DevOps API objects never leave `src/azure/` un-mapped — always go
  through `AzureDevOpsMapper`.
- AI providers only see normalized `ReviewContext`; they must not know
  Azure DevOps exists.

## Testing

```bash
npm test          # unit tests (vitest), all mocked - no network calls
npm run lint
npm run typecheck
```

Unit tests cover: Azure DevOps model mapping, diff line mapping (added,
deleted, modified, renamed, multi-line hunks), AI response parsing
(valid/invalid JSON, missing fields, invalid severity/line numbers,
confidence filtering), review batching/deduplication, approve/reject/edit
transitions, duplicate-comment detection, and secret detection.

### Integration tests

This MVP does not ship live integration tests against a real Azure DevOps
organization (no credentials are available in this environment). To add
them:

1. Provide `AZURE_DEVOPS_ORG`, `AZURE_DEVOPS_PROJECT`,
   `AZURE_DEVOPS_REPOSITORY`, `AZURE_DEVOPS_PAT` as environment variables in
   your own shell (never commit them).
2. Add a test file under `src/test/azure/` that only runs when
   `process.env.AZURE_DEVOPS_PAT` is set (e.g. `it.skipIf(!process.env.AZURE_DEVOPS_PAT)`),
   constructing a real `AzureDevOpsClient` against your PAT/org/project/repo
   and asserting against a known PR in that repository.
3. Keep these tests out of the default `npm test` run's required-to-pass set
   in CI unless the environment variables are present.

## Packaging

```bash
npm run package
```

This type-checks, bundles the extension with esbuild (`dist/extension.js`,
`vscode` kept external), and runs `vsce package` to produce
`azure-pr-review-<version>.vsix`. Install it via **Extensions view → "..." →
Install from VSIX...**.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| "Authentication failed" | PAT missing/expired/wrong scopes. Run **Sign Out** then **Sign In** again. |
| Pull Requests view is empty | Check **Configure Azure DevOps** values match your org/project/repo exactly. |
| "OpenCode was not found" | Ensure the CLI is on `PATH`, or set `azurePrReview.opencode.command` to its full path. |
| "GitHub Copilot review integration is not available..." | Install/enable GitHub Copilot Chat and ensure `vscode.lm` models are available (VS Code 1.90+). |
| A finding shows "Unable to map this finding to a changed line" | The AI referenced a line outside the PR's actual diff; edit the finding manually or reject it - it can't be published as-is. |
| Nothing happens after "Approve" | This is intentional (requirement: no auto-publish) - use **Publish Approved Comments** to actually send it. |

Check **View → Output → Azure PR Review** for detailed (non-sensitive) logs.
