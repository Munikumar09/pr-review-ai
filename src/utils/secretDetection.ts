/**
 * Best-effort detection of obvious secrets before content is sent to an
 * external AI provider (requirement #41). This does NOT guarantee perfect
 * detection - it's a coarse warning, not a security boundary.
 */
export interface SecretMatch {
  kind: string;
  excerpt: string;
}

interface SecretPattern {
  kind: string;
  regex: RegExp;
}

const PATTERNS: SecretPattern[] = [
  { kind: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/g },
  { kind: 'AWS Secret Key', regex: /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g },
  {
    kind: 'Generic API Key',
    regex: /\b[A-Za-z0-9_-]*api[_-]?key[A-Za-z0-9_-]*\s*[:=]\s*['"][A-Za-z0-9_\-.]{16,}['"]/gi,
  },
  { kind: 'Bearer Token', regex: /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}=*/g },
  { kind: 'Private Key', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    kind: 'Azure DevOps PAT-like value',
    regex: /\b(?:[a-z2-7]{52}|[A-Za-z0-9]{75}AZDO[A-Za-z0-9]{5})\b/g,
  },
  {
    kind: 'Connection String',
    regex: /\b(?:Server|Data Source)=[^;\r\n]*;[^\r\n]*?\b(?:Password|Pwd)=[^;\r\n]+/gi,
  },
  { kind: 'Password Assignment', regex: /\bpassword\s*[:=]\s*['"][^'"\s]{6,}['"]/gi },
  {
    kind: 'GitHub Token',
    regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  },
  {
    kind: 'Secret Assignment',
    regex: /\b(?:api[_-]?key|password|secret|access[_-]?token)["']?\s*[:=]\s*["']?[^\s"',;]{8,}/gi,
  },
];

export function detectSecrets(content: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const pattern of PATTERNS) {
    const found = content.match(pattern.regex);
    if (found) {
      for (const match of found) {
        matches.push({ kind: pattern.kind, excerpt: redact(match) });
      }
    }
  }
  return matches;
}

export function containsLikelySecret(content: string): boolean {
  return detectSecrets(content).length > 0;
}

function redact(value: string): string {
  if (value.length <= 8) {
    return '****';
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

const sensitiveValues = new Set<string>();

/** Register actual credentials as well as recognizing common token formats. */
export function registerSecret(value: string): void {
  if (value) sensitiveValues.add(value);
}

export function redactSecrets(text: string): string {
  for (const value of sensitiveValues) text = text.split(value).join('[REDACTED]');
  for (const pattern of PATTERNS) text = text.replace(pattern.regex, '[REDACTED]');
  return text.replace(/\b(?:Bearer|Basic)\s+[^\s]+/gi, '[REDACTED]');
}
