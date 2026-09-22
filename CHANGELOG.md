# Changelog

All notable changes to the "Azure PR Review" extension are documented here.

## [0.5.0]

### Added

- **Draft comment workflow**: human review comments (via the diff editor's
  native Comments UI or the file context menu) are saved as local drafts
  instead of publishing immediately. Add any number of them while
  reviewing, then **Publish All Draft Comments** to send them all at once,
  or **Discard All Draft Comments** to drop them. The Comments view shows
  drafts separately, with per-draft Edit/Remove actions. Replying to an
  already-published thread still posts immediately.
- **Fix** action per finding: jumps to the exact flagged lines and shows
  the AI's suggested fix with a copy-to-clipboard action. It never edits
  files automatically - the human always applies the change.
- **Remove** action per finding: deletes it from the list (distinct from
  the old "Reject", which only changed its status and kept it visible).
- **Approve All** / **Clear All**: approve-and-publish every pending
  finding, or discard every finding, in one confirmed action.
- **Approve** now publishes the finding immediately as a real Azure DevOps
  comment, instead of requiring a separate "Publish Approved Comments"
  step. That command still exists, now as a manual retry for any finding
  whose automatic publish failed (e.g. a network error).
- AI provider and model selection from within the extension: **Select AI
  Provider**, **Select AI Model** (queries `opencode models` for OpenCode,
  or `vscode.lm.selectChatModels` for Copilot, so you pick from what's
  actually available).
- Customizable review prompt: `azurePrReview.ai.customInstructions`
  (multi-line setting, or **Edit Custom Review Prompt**) appends
  house-specific instructions to the built-in prompt without weakening its
  data-handling/output-format rules.
- `azurePrReview.ai.includeAttributionInComments` / **Toggle AI Attribution
  in Published Comments**: publish a plain comment (title, description,
  suggested fix only) with no indication it came from an AI reviewer.
- Additions/Deletions in the PR panel and Changed Files tree now reflect
  real diff stats (previously always showed `+0 -0`, since Azure DevOps's
  changes API doesn't report line counts).
- Sign-in now verifies the PAT immediately and reports the real cause of a
  failure (bad token vs. wrong org/project/repo vs. missing scope) instead
  of a generic "Authentication failed".
- **Configure Azure DevOps**, **Sign In**, **Sign Out** are now reachable
  from the Pull Requests view's `...` menu, not just the Command Palette.
- Multi-line comment selections in the diff editor are now published with
  their full range, instead of collapsing to the first line.

### Fixed

- The Azure DevOps client no longer requires a window reload to pick up a
  connection configured after activation (a stale-config bug that broke
  the normal "activate, then Configure" flow).
- Approve/Reject/Edit no longer trigger a redundant re-fetch and re-diff of
  every changed file over the network; a transient network error there
  could previously prevent the UI from ever reflecting an already-saved
  state change.

### Security

- Require Workspace Trust and prevent workspace overrides of executable,
  connection, provider and secret-detection settings.
- Deny OpenCode tools explicitly via a unique per-run agent, disable
  automatic sharing and external plugins, and isolate all CLI invocations
  from workspace configuration and inherited environment overrides.
- Scan the final, immutable AI prompt right before it's sent, including
  removed lines, metadata and comments; consent is specific to that prompt.
- Persist reviews and drafts under a hash of the full connection identity
  (organization/project/repository), not just PR number; pin the active
  connection until reload and require a reload after changing it.
- Require fresh approval after edits; recheck approval state before each
  publish and serialize publication per PR to close a revoked-approval
  race; invalidate line mappings when a finding's range is edited.
- Render untrusted PR/AI content as plain text in tooltips; escape AI
  comment text; human-authored Azure DevOps comments keep normal Markdown.
- Harden the review panel's webview: nonce-based scripts, no inline event
  handlers, escaped data attributes, an explicit message allowlist, no
  local resource access.
- Redact PATs and common secret formats from logs; stop echoing raw
  SDK/provider exception detail in user-facing errors.
- Bound remote input: file downloads and AI responses capped at 2 MiB,
  prompts at 512 KiB, review context at 32 MiB / 500 files, and diffs at
  2,000 edits or 250 ms - reviews that exceed these limits fail instead of
  silently publishing findings based on partial content.
- Validate Azure DevOps organization/URL path segments, refuse
  non-HTTPS/non-Azure external links and authenticated redirects, and
  exclude environment and private-key files from the packaged VSIX.

See [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for the full findings/impact/
remediation table from this pass.

## [0.1.0]

### Added

- Initial MVP: Azure DevOps authentication (PAT), pull request browsing, PR
  metadata, changed-files tree, native VS Code diff viewing, human review
  comments, existing comment browsing.
- AI review pipeline with a provider abstraction (Mock, OpenCode, Copilot
  stub), structured JSON findings, line mapping to Azure DevOps diff
  positions, duplicate detection, and a mandatory human-approval gate before
  any AI comment is published.
- Secret-detection warning and prompt-injection hardening for AI review
  context.
