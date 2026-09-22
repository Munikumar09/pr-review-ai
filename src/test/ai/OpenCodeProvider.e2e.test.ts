import { describe, expect, it } from 'vitest';
import { OpenCodeProvider } from '../../ai/providers/OpenCodeProvider';
import { ReviewPromptBuilder } from '../../ai/ReviewPromptBuilder';
import { ReviewContext } from '../../ai/AIReviewProvider';

// Opt-in: talks to the real OpenCode CLI and a real model.
// Run with: OPENCODE_E2E=1 npx vitest run src/test/ai/OpenCodeProvider.e2e.test.ts
const enabled = process.env.OPENCODE_E2E === '1';

const diff = [
  '--- a/db.py',
  '+++ b/db.py',
  '@@ -1,3 +1,6 @@',
  ' import sqlite3',
  ' ',
  '+def find_user(conn, name):',
  '+    query = "SELECT * FROM users WHERE name = \'" + name + "\'"',
  '+    return conn.execute(query).fetchall()',
].join('\n');

const context: ReviewContext = {
  pullRequest: {
    id: 1,
    title: 'Add user lookup',
    description: 'Adds find_user',
    status: 'active',
    isDraft: false,
    sourceBranch: 'feature/lookup',
    targetBranch: 'main',
    repositoryId: 'r',
    repositoryName: 'repo',
    projectId: 'p',
    projectName: 'proj',
    createdBy: 'dev',
    creationDate: '',
    lastUpdateDate: '',
    url: '',
    webUrl: '',
  },
  files: [
    {
      path: 'db.py',
      language: 'python',
      oldContent: 'import sqlite3\n\n',
      newContent:
        'import sqlite3\n\ndef find_user(conn, name):\n    query = "SELECT * FROM users WHERE name = \'" + name + "\'"\n    return conn.execute(query).fetchall()\n',
      diff,
      additions: 3,
      deletions: 0,
    },
  ],
  existingComments: [],
};

describe.skipIf(!enabled)('OpenCodeProvider (real CLI)', () => {
  const provider = new OpenCodeProvider(
    () => 'opencode',
    () => '',
    new ReviewPromptBuilder(process.cwd()),
  );

  it('detects the installed CLI', async () => {
    expect(await provider.isAvailable()).toBe(true);
  });

  it('returns validated findings for an obvious SQL injection', async () => {
    const result = await provider.review(context, {
      mode: 'security',
      maxFindings: 5,
      minConfidence: 0.5,
      categories: ['security', 'bug'],
    });

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].filePath).toBe('db.py');
    expect(result.findings[0].status).toBe('pending');
  }, 180_000);
});
