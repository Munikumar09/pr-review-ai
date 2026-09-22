# Changelog

All notable changes to the "Azure PR Review" extension are documented here.

## Unreleased

### Security

- Require Workspace Trust and prevent workspace overrides of executable,
  connection, provider and secret-detection settings.
- Deny OpenCode tools explicitly, disable automatic sharing and external
  plugins, and isolate all CLI invocations from workspace configuration.
- Scan the final AI prompt, including removed lines, metadata and comments.
- Isolate persisted reviews and drafts by repository; connection changes now
  require a window reload. Unscoped legacy state is not automatically restored.
- Require fresh approval after edits and prevent concurrent or revoked-approval
  publication; render untrusted Markdown literally.
- Add webview CSP nonces, message validation, safe URL handling, redacted logging,
  bounded downloads/diffs/model output, and stricter AI output validation.
- Exclude environment files and private-key files from extension packages.

## [0.1.0] - Unreleased

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
