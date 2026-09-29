import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTask, validateResult, validateAssignedChanges, safePath } from '../scripts/harness/validate.mjs';

const root = process.cwd();
const base = {
  schema_version: '0.1', task_id: 'H-TEST-1', contract_revision: 1,
  objective: 'Inspect one contract', mode: 'analysis',
  authorization: { source: 'test', scope: 'analysis only' }, workspace: root,
  baseline: { kind: 'git', ref: '5977cdb' }, role: 'qa', runtime: 'codex-native', model: 'gpt-6-sol', reasoning: 'medium',
  depends_on: [], read_refs: ['AGENTS.md', 'context.md'], write_allowlist: [], protected_paths: ['docs/H1_RESULTADOS.json'],
  invariants: ['No mutation'], acceptance: [{ id: 'A1', criterion: 'Finding is sourced' }],
  checks: [{ id: 'V1', kind: 'inspection', target: 'A1', environment: 'local', owner: 'worker' }],
  constraints: { network: 'not_needed', nested_delegation: false, summary_words_target: 500 }, stop_conditions: ['missing source'],
};
const report = {
  schema_version: '0.1', task_id: 'H-TEST-1', contract_revision: 1, status: 'ready_for_review', baseline_ref: '5977cdb',
  actual_execution: { runtime: 'codex-native', model: 'gpt-6-sol', reasoning: 'medium' }, summary: 'Checked the source.',
  artifacts: [], changed_files: [], criteria: [{ id: 'A1', status: 'pass', evidence_refs: ['AGENTS.md'] }],
  checks: [{ id: 'V1', status: 'pass', environment: 'local', procedure: 'Read AGENTS.md', executed_at: '2026-09-29T00:00:00Z', exit_code: 0, assertions: 'Source exists', evidence_refs: ['AGENTS.md'] }],
  findings: [], assumptions: [], context_requests: [], risks: [],
  metrics: { elapsed_seconds: null, input_tokens: null, output_tokens: null, cost: null, source: 'unavailable' }, next_action: 'Review the result.',
};
const task = (patch = {}) => ({ ...base, ...patch });
const result = (patch = {}) => ({ ...report, ...patch });

test('accepts a bounded read-only task and evidenced report', () => {
  const parsed = validateTask(task(), { checkGit: false });
  assert.equal(validateResult(parsed, result()).status, 'ready_for_review');
});

test('rejects traversal and protected writes', () => {
  assert.throws(() => safePath(root, '../outside'), /invalid path/);
  assert.throws(() => safePath(root, '.env.local'), /private or generated path/);
  assert.throws(() => safePath(root, 'module/.env.local'), /private or generated path/);
  assert.throws(() => safePath(root, '.git/config'), /private or generated path/);
  assert.throws(() => validateTask(task({ read_refs: ['AGENTS.md', '../secret'] }), { checkGit: false }), /invalid path/);
  assert.throws(() => validateTask(task({ mode: 'implementation', write_allowlist: ['docs/'], protected_paths: ['docs/H1_RESULTADOS.json'] }), { checkGit: false }), /protected path/);
});

test('rejects unsupported baselines and unknown contract fields', () => {
  assert.throws(() => validateTask(task({ baseline: { kind: 'manifest', ref: 'abc' } }), { checkGit: false }), /not supported/);
  assert.throws(() => validateTask(task({ read_refs: ['AGENTS.md'] }), { checkGit: false }), /must include/);
  assert.throws(() => validateTask(task({ surprise: true }), { checkGit: false }));
});

test('rejects PASS without evidence and missing criteria', () => {
  const parsed = validateTask(task(), { checkGit: false });
  assert.throws(() => validateResult(parsed, result({ criteria: [{ id: 'A1', status: 'pass', evidence_refs: [] }] })), /PASS without evidence/);
  assert.throws(() => validateResult(parsed, result({ criteria: [] })), /criteria coverage mismatch/);
  assert.throws(() => validateResult(parsed, result({ criteria: [{ id: 'A1', status: 'not_run', evidence_refs: [] }] })), /missing reason/);
});

test('rejects invented execution data and baseline mismatch', () => {
  const parsed = validateTask(task(), { checkGit: false });
  const checks = [{ id: 'V1', status: 'not_run', environment: 'local', executed_at: '2026-09-29T00:00:00Z', evidence_refs: [], reason: 'Unavailable' }];
  assert.throws(() => validateResult(parsed, result({ checks })), /not_run has execution data/);
  assert.throws(() => validateResult(parsed, result({ baseline_ref: 'wrong' })), /baseline mismatch/);
});

test('compares real changed paths with the assigned and reported paths', () => {
  const parsed = validateTask(task({ mode: 'implementation', write_allowlist: ['packages/domain/'] }), { checkGit: false });
  assert.throws(() => validateAssignedChanges(parsed, ['app/actions.ts'], ['app/actions.ts']), /outside assignment/);
  assert.throws(() => validateAssignedChanges(parsed, ['packages/domain/tenancy.ts'], []), /differ/);
  assert.doesNotThrow(() => validateAssignedChanges(parsed, ['packages/domain/tenancy.ts'], ['packages/domain/tenancy.ts']));
});
