# Security review

Reviewed the VS Code extension's authentication, configuration, Azure API calls,
AI providers, review/publishing state, webviews, Markdown rendering, packaging
and locked npm dependencies. This is a source review with regression tests, not
a claim that the repository or third-party services have no remaining vulnerabilities.

| Finding | Impact | Remediation |
| --- | --- | --- |
| Workspace-controlled executable and security settings | A repository could select an executable or change the destination/provider/secret-warning behavior. | User-only sensitive settings, machine-scoped CLI path, explicit Workspace Trust guards, rejection of relative executable paths and relative PATH entries. |
| Temporary cwd treated as an OpenCode sandbox | A prompt-injected agent could use normally allowed shell, network or other tools; inherited settings could enable sharing. | Explicit deny-all permissions, a unique review agent with deny-all permissions, pure mode, disabled sharing/project configuration, isolated cwd for probes and model listing as well as reviews. No fallback to permissive execution. |
| Secret scanner inspected only new file content | Removed secrets, PR metadata, comments and custom instructions could be sent without a warning. | Check the exact immutable prompt immediately before sending. Consent is specific to that prompt; cancellation prevents transmission. |
| Review/draft state keyed only by PR number | Changing organizations/repositories could restore unrelated findings or send comments to the wrong destination. | Persist under a hash of the complete connection identity; pin the active connection until reload and block requests after configuration changes. Close stale panels and cancel active reviews. Do not guess the ownership of legacy unscoped state. |
| Edited findings eligible for publication; approval races | Editing alone counted as approval, and asynchronous publication could use an approval that was subsequently revoked. | Publish approved findings only, recheck state before each write, serialize publication per PR, preserve concurrent edits and invalidate mappings when line ranges change. |
| Active Markdown from PRs and models | Untrusted text could render remote images or misleading links in tooltips or published AI comments. | Plain-text tooltips and escaped AI comment text preserve the content actually reviewed. Human-authored Azure comments retain their normal Markdown support. |
| Permissive webview policy and unchecked IPC | Inline script policy and unchecked messages weakened the boundary around publication actions. | Random script/style nonces, no inline event handlers, escaped data attributes, explicit message allowlist and no local resource roots. This is defense in depth; parsed AI finding IDs were already generated locally. |
| Errors and parser diagnostics could echo sensitive data | CLI stderr, SDK objects or JSON parse errors could expose credentials or source in output/UI. | Omit arbitrary exception details/request objects, use safe provider errors, redact registered PATs and common secret formats, and remove attacker-controlled diagnostic values. |
| Unbounded remote input and expensive diffs | Large files, AI output or adversarial diffs could exhaust memory or block the extension host. | File/AI response byte limits, download timeouts, cumulative context/prompt limits, diff time/edit budgets and safe rejection of primitive/null findings or unsafe line numbers. |
| URL and package boundary hardening | Malformed organization names, non-HTTPS external links and accidentally packaged local secret files broadened exposure. | Validate organization path segments, refuse credentialed/non-Azure/non-HTTPS external URLs, disable authenticated HTTP redirects, ignore environment/private-key files in Git, and allowlist runtime assets/public documentation in VSIX packaging. |

The regression suite exercises malicious settings, secret-bearing deleted lines,
metadata/comments/instructions, rejected consent, output overflow, hostile webview
content and IPC, colliding repository state, approval revocation/concurrency,
pathological diffs, invalid URLs and sensitive error handling.

Validation uses Node 24. The default test suite does not contact Azure DevOps or
real AI providers. The opt-in Azure/OpenCode integration tests remain disabled;
the OpenCode executable is not installed in the review environment. Its permission
policy is verified in process-launch tests against the documented CLI contract,
not through a live agent run. VS Code rendering is tested through its local mock,
not a full extension-host session.

The locked dependency audit reported **zero known vulnerabilities**. This audit
does not cover the user's independently installed OpenCode CLI or detect unknown
vulnerabilities. A credential-pattern scan of tracked files found only deliberate
test fixtures, not a confirmed committed credential.

Operational changes: move sensitive workspace settings to user settings, reload
after changing the connection, and re-create reviews/drafts stored by the old
unscoped format. VS Code workspace storage still contains findings and drafts;
OpenCode and model providers have their own session-retention policies. A trusted
CLI/user configuration remains necessary: a temporary directory and CLI permission
policy are not an operating-system sandbox, and prompt instructions cannot guarantee
that a model will ignore every injection attempt.

Implementation references: [VS Code Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust),
[OpenCode permissions](https://opencode.ai/docs/permissions/),
[OpenCode configuration precedence](https://opencode.ai/docs/config/), and
[OpenCode CLI configuration](https://opencode.ai/docs/cli/).
