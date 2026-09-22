# Azure DevOps AI PR Review

Review Azure DevOps pull requests without leaving VS Code — browse PRs, view
diffs with the native diff editor, read and add comments, and optionally run
an AI-assisted review whose findings must be explicitly approved by a human
before anything is published back to Azure DevOps.

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
  Comments UI, or from the file context menu). These are saved as **local
  drafts** first — add as many as you like while you review, then **Publish
  All Draft Comments** to send them to Azure DevOps in one batch (or
  **Discard All** to drop them). Replying to an already-published thread
  still posts immediately, since that's a live conversation, not a draft.
- Run an AI review of an entire PR, selected files, or the current file,
  with selectable review modes (Full/Bug/Security/Performance/
  Maintainability/Test), a choice of provider (Mock/OpenCode/Copilot) and
  model, and an optional custom prompt appended to the built-in one.
- AI findings are shown with severity, confidence, and a suggested fix. They
  are **never** published automatically — per finding you can **Approve**
  (publishes it immediately), **Edit** its text, **Fix** (jumps to the exact
  code and shows the suggestion — never edits files for you), or **Remove**
  it from the list. **Approve All** does the same for every pending finding
  at once, behind a confirmation. **Clear All** discards every finding
  without publishing anything.
- AI attribution in published comments (the "[AI Review - severity -
  category]" label, confidence and provider name) can be turned off, so a
  comment reads like any other reviewer wrote it.
- Duplicate detection avoids re-posting a comment that already exists on the
  PR.
- Secret-detection warning before PR content is sent to an AI provider.
- Large-PR safeguards: above ~100 files or ~10k changed lines, you're asked
  to narrow the review scope instead of reviewing everything at once.

## Requirements

- VS Code 1.85+
- An Azure DevOps organization, project, and Git repository you have access to
- A Personal Access Token with **Code (Read & Write)** and **Pull Request**
  scopes
- Optional: the [OpenCode](https://opencode.ai) CLI on your `PATH` for the
  OpenCode AI provider
- Optional: GitHub Copilot Chat installed and signed in, for the Copilot
  provider (uses the supported `vscode.lm` Language Model API)

## Azure DevOps setup

1. In Azure DevOps, go to **User Settings → Personal Access Tokens** and
   create a token with **Code (Read & Write)** scope (this covers Pull
   Request read/write).
2. Run **Azure PR Review: Configure Azure DevOps** from the Command Palette
   and enter your organization, project, and repository names.
3. Run **Azure PR Review: Sign In** and paste the token when prompted.

## Authentication

Sign-in uses a Personal Access Token, stored exclusively in VS Code's secure
credential storage — it is never written to settings, workspace files, or
logs.

## OpenCode setup

1. Install the OpenCode CLI so it's available on your `PATH` (or set
   `azurePrReview.opencode.command` to its full path).
2. Set `azurePrReview.ai.provider` to `"opencode"`.
3. Run **Azure PR Review: Run AI Review**. The extension checks
   `<command> --version` first and shows a clear error if OpenCode isn't
   found, rather than failing silently.

Each review runs in an isolated temporary directory with a dedicated,
permission-denied agent — external plugins, project configuration, and
automatic session sharing are all disabled, and the extension never retries
with weaker permissions. This relies on OpenCode's own permission
enforcement, not an operating-system sandbox: use a trusted, current CLI
installation. The CLI is not bundled with the extension.

## Configuration

Connection, provider, model, custom instructions and secret-detection choices
are read from **user settings**, so a repository's own `.vscode/settings.json`
cannot override them. Changing the organization, project or repository
requires **Reload Window**.

| Setting | Default | Description |
|---|---|---|
| `azurePrReview.organization` | `""` | Azure DevOps organization |
| `azurePrReview.project` | `""` | Azure DevOps project |
| `azurePrReview.repository` | `""` | Azure DevOps repository |
| `azurePrReview.ai.provider` | `"mock"` | `mock` \| `opencode` \| `copilot` |
| `azurePrReview.ai.maxFindings` | `20` | Cap on findings kept per review |
| `azurePrReview.ai.minConfidence` | `0.75` | Minimum confidence (0-1) to keep a finding |
| `azurePrReview.ai.reviewCategories` | bug/security/performance/maintainability/testing | Categories the AI should focus on |
| `azurePrReview.ai.customInstructions` | `""` | Extra instructions appended to the built-in review prompt (multi-line). Edit via **Azure PR Review: Edit Custom Review Prompt** |
| `azurePrReview.ai.includeAttributionInComments` | `true` | Label published comments as AI-generated with confidence/provider. Toggle via **Azure PR Review: Toggle AI Attribution in Published Comments** |
| `azurePrReview.opencode.command` | `"opencode"` | Executable used for the OpenCode provider (must be absolute or resolvable on `PATH`) |
| `azurePrReview.opencode.model` | `""` | Model passed to OpenCode as `provider/model`. Empty uses OpenCode's own default. Set via **Azure PR Review: Select AI Model** |
| `azurePrReview.copilot.model` | `""` | Preferred Copilot chat model id/family. Empty uses the first available model. Set via **Azure PR Review: Select AI Model** |
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
   and choose **Add Comment**. This saves a local draft, not a published
   comment — add as many as you like, then use **Publish All Draft
   Comments** (Comments view `...` menu) when your review is done.
5. Check the **Comments** view for drafts (shown separately at the top,
   with Edit/Remove actions) and existing published threads; click one to
   jump to its file/line.

## AI review workflow

1. Optionally run **Azure PR Review: Select AI Provider** (Mock/OpenCode/
   Copilot), **Select AI Model**, and **Edit Custom Review Prompt** first —
   these are remembered for future reviews.
2. Right-click a PR (or use the PR panel) → **Run AI Review**, or use
   **AI Review Current File** from a file's context menu.
3. For large PRs you'll be asked to choose a scope (entire PR vs. selected
   files) before anything is sent to the AI provider.
4. If likely secrets are detected in the diff content, you'll be asked to
   confirm before continuing.
5. Pick a review mode (Full/Bug/Security/Performance/Maintainability/Test).
6. Progress is shown in a cancellable notification. Findings appear in the
   **Review Findings** view and the PR panel, grouped by severity.
7. For each finding:
   - **Approve** immediately publishes it as a real Azure DevOps comment.
     There is no separate confirmation for a single finding, since clicking
     it is the confirmation — nothing is sent to Azure DevOps before you
     click it.
   - **Edit** changes its title/description/suggested fix without
     publishing anything.
   - **Fix** jumps to the exact flagged lines and shows the suggested fix
     text with a copy-to-clipboard action. It never edits your files - you
     always apply the fix yourself.
   - **Remove** deletes the finding from the list; it never touches Azure
     DevOps.
8. **Approve All** approves and publishes every pending finding in one
   batch, behind a confirmation dialog (it posts several real comments at
   once). **Clear All** discards every finding without publishing anything,
   also behind a confirmation.
9. If an Approve's publish attempt fails (e.g. a network error), the finding
   stays approved-but-unpublished; **Publish Approved Comments** retries any
   such leftovers. Duplicates and findings that couldn't be safely mapped to
   a line are always skipped and reported, never silently published.

## Security considerations

- PR content is treated as **untrusted data**: the AI prompt explicitly
  instructs the model to never follow instructions embedded in repository
  content and to never reveal credentials/secrets, even if content in the PR
  asks it to.
- The extension never executes code from the PR (no automatic
  `npm install`, `pip install`, `make`, test runs, etc.).
- AI line numbers are never trusted blindly — every finding is validated
  against the PR's actual diff before it can be published; unmappable
  findings are blocked with a clear message.
- A best-effort secret scanner flags API keys, private keys, bearer tokens,
  AWS keys, connection strings, and similar patterns before content leaves
  VS Code for an AI provider. This is a warning, not a guarantee.
- Only explicitly approved AI findings can be published. Editing a finding
  requires a fresh approval, and editing its line range invalidates the mapping.
- Secret scanning checks the actual outbound prompt, including deleted diff
  lines, PR metadata, existing comments and custom instructions. A warning is
  accepted only through the explicit **Send to AI Provider** action.
- Network file downloads and AI responses are capped at 2 MiB. Prompts are
  capped at 512 KiB, review context at 32 MiB and 500 files, and each diff at
  2,000 edits or 250 ms. Reviews that exceed these limits fail instead of
  silently publishing findings based on partial content.
- Credentials remain in secure storage; raw SDK/provider errors are excluded
  from logs. Findings and human drafts are still persisted in VS Code
  workspace storage and may contain sensitive review text.
- The extension requires Workspace Trust.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| "Authentication failed" | PAT missing/expired/wrong scopes. Run **Sign Out** then **Sign In** again. |
| Pull Requests view is empty | Check **Configure Azure DevOps** values match your org/project/repo exactly. |
| "OpenCode was not found" | Ensure the CLI is on `PATH`, or set `azurePrReview.opencode.command` to its full path. |
| "GitHub Copilot review integration is not available..." | Install/enable GitHub Copilot Chat and ensure `vscode.lm` models are available (VS Code 1.90+). |
| A finding shows "Unable to map this finding to a changed line" | The AI referenced a line outside the PR's actual diff; edit the finding manually or remove it - it can't be published as-is. |
| Clicking "Approve" seems to do nothing | Check the notification area - it publishes immediately and reports success/failure/duplicate/unmapped there. If it reports a failure, the finding stays "approved" and **Publish Approved Comments** will retry it. |
| My draft comments aren't on the PR yet | Drafts are local until you run **Publish All Draft Comments** (Comments view `...` menu) - this is intentional, so you can write a whole review before anything is sent. |

Check **View → Output → Azure PR Review** for detailed (non-sensitive) logs.

---

Source code, issue tracker and full developer documentation:
[github.com/Munikumar09/ai-pr-review](https://github.com/Munikumar09/ai-pr-review)
