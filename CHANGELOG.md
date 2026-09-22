# Changelog

All notable changes to the "Azure PR Review" extension are documented here.

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
