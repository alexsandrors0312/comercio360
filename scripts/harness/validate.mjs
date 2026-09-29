import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, relative, dirname, isAbsolute, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

const nonempty = z.string().trim().min(1);
const textList = z.array(nonempty);
const criterionState = z.enum(['pass', 'fail', 'not_run', 'not_applicable']);
const taskSchema = z.object({
  schema_version: z.literal('0.1'), task_id: nonempty, contract_revision: z.number().int().positive(),
  objective: nonempty, mode: z.enum(['analysis', 'implementation', 'review']),
  authorization: z.object({ source: nonempty, scope: nonempty }).strict(),
  workspace: nonempty,
  baseline: z.object({ kind: z.enum(['git', 'manifest']), ref: nonempty }).strict(),
  role: nonempty, runtime: nonempty, model: nonempty, reasoning: nonempty,
  depends_on: z.array(z.object({ task_id: nonempty, contract_revision: z.number().int().positive(), state: nonempty }).strict()),
  read_refs: textList, write_allowlist: textList, protected_paths: textList,
  invariants: textList,
  acceptance: z.array(z.object({ id: nonempty, criterion: nonempty }).strict()).min(1),
  checks: z.array(z.object({ id: nonempty, kind: nonempty, target: nonempty, environment: nonempty, owner: nonempty }).strict()),
  constraints: z.object({ network: nonempty, nested_delegation: z.boolean(), summary_words_target: z.number().int().positive() }).strict(),
  stop_conditions: textList,
}).strict();

const reportedCriterion = z.object({ id: nonempty, status: criterionState, evidence_refs: textList, reason: nonempty.optional() }).strict();
const resultSchema = z.object({
  schema_version: z.literal('0.1'), task_id: nonempty, contract_revision: z.number().int().positive(),
  status: z.enum(['ready_for_review', 'needs_context', 'blocked', 'failed']),
  baseline_ref: nonempty,
  actual_execution: z.object({ runtime: nonempty.nullable(), model: nonempty.nullable(), reasoning: nonempty.nullable() }).strict(),
  summary: nonempty,
  artifacts: z.array(z.object({ path: nonempty, type: nonempty, sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict()),
  changed_files: z.array(z.object({ path: nonempty, operation: z.enum(['added', 'modified', 'deleted']), purpose: nonempty }).strict()),
  criteria: z.array(reportedCriterion),
  checks: z.array(z.object({ id: nonempty, status: criterionState, environment: nonempty, procedure: nonempty.optional(), cwd: nonempty.optional(), executed_at: z.string().datetime({ offset: true }).optional(), exit_code: z.number().int().nullable().optional(), assertions: nonempty.optional(), evidence_refs: textList, reason: nonempty.optional() }).strict()),
  findings: z.array(z.object({ severity: nonempty, summary: nonempty, evidence_refs: textList }).strict()),
  assumptions: textList,
  context_requests: z.array(z.object({ item: nonempty, reason: nonempty }).strict()),
  risks: textList,
  metrics: z.object({ elapsed_seconds: z.number().nonnegative().nullable(), input_tokens: z.number().int().nonnegative().nullable(), output_tokens: z.number().int().nonnegative().nullable(), cost: z.number().nonnegative().nullable(), source: nonempty }).strict(),
  next_action: nonempty,
}).strict();

function assert(condition, message) { if (!condition) throw new Error(message); }
function unique(items, label) { assert(new Set(items).size === items.length, `${label}: duplicate ID/path`); }

export function safePath(workspace, repoPath) {
  assert(typeof repoPath === 'string' && repoPath.length > 0, 'empty path');
  assert(!isAbsolute(repoPath) && !repoPath.includes('\\') && !repoPath.includes(':') && !repoPath.startsWith('/'), `invalid path: ${repoPath}`);
  const parts = repoPath.replace(/\/$/, '').split('/');
  assert(parts.every(part => part && part !== '.' && part !== '..'), `invalid path: ${repoPath}`);
  assert(!parts.some(part => ['.git', 'node_modules', '.next', '.next-e2e', 'coverage', 'test-results', 'playwright-report'].includes(part) || /^\.env($|\.)/.test(part)), `private or generated path: ${repoPath}`);
  const root = realpathSync(workspace);
  const target = resolve(root, ...parts);
  let existing = target;
  while (!existsSync(existing)) existing = dirname(existing);
  const resolved = realpathSync(existing);
  const tail = relative(existing, target);
  const full = resolve(resolved, tail);
  const rel = relative(root, full);
  assert(rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), `path escapes workspace: ${repoPath}`);
  return target;
}

function under(path, owner) { return owner.endsWith('/') ? path.startsWith(owner) : path === owner; }
function paths(task) {
  const all = [...task.read_refs, ...task.write_allowlist, ...task.protected_paths];
  for (const item of all) safePath(task.workspace, item);
  unique(task.write_allowlist, 'write_allowlist');
  for (const path of task.write_allowlist) assert(!task.protected_paths.some(p => under(path, p) || under(p, path)), `protected path assigned for writing: ${path}`);
}

function assertGitBaseline(task) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: realpathSync(task.workspace), encoding: 'utf8' }).trim();
  assert(head === task.baseline.ref, 'Git HEAD differs from task baseline');
}

export function validateTask(raw, { checkGit = true } = {}) {
  const task = taskSchema.parse(raw);
  const root = realpathSync(task.workspace);
  assert(root.toLowerCase() === realpathSync(process.cwd()).toLowerCase(), 'workspace differs from current directory');
  unique(task.acceptance.map(x => x.id), 'acceptance');
  unique(task.checks.map(x => x.id), 'checks');
  if (task.mode !== 'implementation') assert(task.write_allowlist.length === 0, 'read-only mode has write assignment');
  if (task.mode === 'implementation') assert(task.write_allowlist.length > 0, 'implementation needs write assignment');
  paths(task);
  assert(task.read_refs.includes('AGENTS.md') && task.read_refs.includes('context.md'), 'task must include AGENTS.md and context.md');
  for (const ref of task.read_refs) assert(existsSync(safePath(task.workspace, ref)), `read reference missing: ${ref}`);
  assert(task.baseline.kind === 'git', 'manifest baseline is not supported by this validator');
  if (checkGit) assertGitBaseline(task);
  return task;
}

export function validateAssignedChanges(task, changedPaths, reportedPaths) {
  unique(changedPaths, 'actual changes');
  unique(reportedPaths, 'reported changes');
  for (const path of [...changedPaths, ...reportedPaths]) safePath(task.workspace, path);
  for (const path of changedPaths) assert(task.write_allowlist.some(owner => under(path, owner)), `change outside assignment: ${path}`);
  assert(changedPaths.length === reportedPaths.length && changedPaths.every(p => reportedPaths.includes(p)), 'reported changed_files differ from actual Git changes');
}

export function validateResult(task, raw, { actualChanges = undefined, checkArtifacts = true, checkGit = true } = {}) {
  const result = resultSchema.parse(raw);
  assert(result.task_id === task.task_id && result.contract_revision === task.contract_revision, 'result task/revision mismatch');
  assert(result.baseline_ref === task.baseline.ref, 'result baseline mismatch');
  if (checkGit) assertGitBaseline(task);
  unique(result.criteria.map(x => x.id), 'result criteria');
  unique(result.checks.map(x => x.id), 'result checks');
  unique(result.changed_files.map(x => x.path), 'changed_files');
  const criterionIds = task.acceptance.map(x => x.id);
  assert(result.criteria.length === criterionIds.length && criterionIds.every(id => result.criteria.some(c => c.id === id)), 'criteria coverage mismatch');
  for (const item of [...result.criteria, ...result.checks]) {
    if (item.status === 'pass') assert(item.evidence_refs.length > 0, `PASS without evidence: ${item.id}`);
    if (item.status === 'not_run' || item.status === 'not_applicable') assert(item.reason, `missing reason: ${item.id}`);
    for (const ref of item.evidence_refs) assert(existsSync(safePath(task.workspace, ref)), `evidence missing: ${ref}`);
  }
  for (const finding of result.findings) {
    assert(finding.evidence_refs.length > 0, `finding without evidence: ${finding.summary}`);
    for (const ref of finding.evidence_refs) assert(existsSync(safePath(task.workspace, ref)), `evidence missing: ${ref}`);
  }
  for (const check of result.checks) {
    assert(task.checks.some(x => x.id === check.id), `unexpected check: ${check.id}`);
    if (check.status === 'not_run') assert(check.executed_at === undefined && check.exit_code === undefined, `not_run has execution data: ${check.id}`);
    if (check.status === 'pass' && check.exit_code !== undefined) assert(check.exit_code === 0, `PASS with nonzero exit: ${check.id}`);
  }
  if (task.mode !== 'implementation') assert(result.changed_files.length === 0, 'read-only task reported changes');
  for (const file of result.changed_files) {
    safePath(task.workspace, file.path);
    assert(task.write_allowlist.some(owner => under(file.path, owner)), `reported change outside assignment: ${file.path}`);
  }
  const changedPaths = actualChanges ?? gitChangedPaths(task.workspace);
  if (task.mode !== 'implementation') assert(changedPaths.length === 0, 'read-only task has actual Git changes');
  validateAssignedChanges(task, changedPaths, result.changed_files.map(x => x.path));
  if (checkArtifacts) for (const artifact of result.artifacts) {
    const file = safePath(task.workspace, artifact.path);
    assert(existsSync(file) && statSync(file).isFile(), `artifact missing: ${artifact.path}`);
    assert(createHash('sha256').update(readFileSync(file)).digest('hex') === artifact.sha256, `artifact hash mismatch: ${artifact.path}`);
  }
  if (result.status === 'ready_for_review') assert(result.criteria.every(c => c.status !== 'fail'), 'ready_for_review with failed criterion');
  return result;
}

function gitChangedPaths(root) {
  const worktree = execFileSync('git', ['diff', '--name-only', '-z'], { cwd: root }).toString('utf8').split('\0').filter(Boolean);
  const staged = execFileSync('git', ['diff', '--cached', '--name-only', '-z', 'HEAD'], { cwd: root }).toString('utf8').split('\0').filter(Boolean);
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root }).toString('utf8').split('\0').filter(Boolean);
  return [...new Set([...worktree, ...staged, ...untracked])];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [kind, taskFile, resultFile] = process.argv.slice(2);
    assert(['task', 'result'].includes(kind) && taskFile, 'usage: validate.mjs task TASK.json | result TASK.json RESULT.json');
    const task = validateTask(JSON.parse(readFileSync(taskFile, 'utf8')));
    if (kind === 'task') assert(gitChangedPaths(task.workspace).length === 0, 'dispatch requires a clean Git worktree');
    if (kind === 'result') {
      assert(resultFile, 'result file required');
      validateResult(task, JSON.parse(readFileSync(resultFile, 'utf8')));
    }
    console.log(`${kind} valid: ${task.task_id}@${task.contract_revision}`);
  } catch (error) {
    console.error(error instanceof z.ZodError ? error.issues.map(x => `${x.path.join('.')}: ${x.message}`).join('\n') : error.message);
    process.exitCode = 1;
  }
}
