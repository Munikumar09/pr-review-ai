import { describe, expect, it } from 'vitest';
import { detectSecrets, containsLikelySecret } from '../../utils/secretDetection';

describe('secretDetection', () => {
  it('detects an AWS access key', () => {
    const matches = detectSecrets('const key = "AKIAABCDEFGHIJKLMNOP";');
    expect(matches.some((m) => m.kind === 'AWS Access Key')).toBe(true);
  });

  it('detects a private key block', () => {
    const matches = detectSecrets(
      '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK...\n-----END RSA PRIVATE KEY-----',
    );
    expect(matches.some((m) => m.kind === 'Private Key')).toBe(true);
  });

  it('detects a bearer token', () => {
    const matches = detectSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345');
    expect(matches.some((m) => m.kind === 'Bearer Token')).toBe(true);
  });

  it('does not flag ordinary source code', () => {
    expect(containsLikelySecret('function add(a, b) { return a + b; }')).toBe(false);
  });

  it('redacts the matched excerpt', () => {
    const matches = detectSecrets('const key = "AKIAABCDEFGHIJKLMNOP";');
    for (const match of matches) {
      expect(match.excerpt).not.toContain('AKIAABCDEFGHIJKLMNOP');
    }
  });
});
