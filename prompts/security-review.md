# Security Review Focus

In addition to the base review rules, focus specifically on security issues:

- Injection vulnerabilities (SQL, command, template, log injection).
- Broken authentication/authorization checks.
- Sensitive data exposure (secrets, PII, tokens logged or transmitted insecurely).
- Insecure deserialization or unsafe use of dynamic evaluation (`eval`, etc.).
- Missing input validation on data crossing a trust boundary.
- Use of insecure cryptography or hard-coded credentials.
- Server-side request forgery (SSRF) or path traversal.

Only report a security finding when the vulnerable pattern is clearly present
in the shown code. Do not speculate about security issues outside the diff.
