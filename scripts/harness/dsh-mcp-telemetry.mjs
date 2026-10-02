#!/usr/bin/env node
/**
 * dsh-mcp — a zero-dependency MCP stdio server exposing DeepSeek Harness to
 * MCP clients (Cursor, Codex, Claude Desktop, ...).
 *
 * Tools:
 *   dsh_delegate  run one task through `dsh --profile headless`, return the
 *                 final assistant text and source-labeled telemetry
 *   dsh_health    report dsh availability, version, and profile presence
 *
 * Stdout carries only MCP JSON-RPC frames; diagnostics go to stderr.
 * Run: node server/dsh-mcp.mjs   (env: DSH_HOME optional, DSH_MCP_PROFILE optional)
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";
import { createInterface } from "node:readline";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const NAME = "dsh-mcp";
// Windows patch over upstream 81def5abbc01bd5b461710ed11a595bb4355f5f7 (MIT).
const VERSION = "0.1.0-c360.2";
const MCP_PROTOCOL = "2024-11-05";
const PROFILE = process.env.DSH_MCP_PROFILE ?? "headless";
const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TASK_CHARS = 20000;
const MAX_OUTPUT_CHARS = 1000000;
const MAX_TELEMETRY_CHARS = 4096;
const workspaceKey = (p) => process.platform === "win32" ? p.toLowerCase() : p;
const allowedWorkspaces = JSON.parse(process.env.DSH_MCP_ALLOWED_WORKSPACES ?? "[]")
  .map((p) => workspaceKey(realpathSync(p)));
const telemetryRoot = allowedWorkspaces[0] ?? process.cwd();
const telemetryPatch = process.env.DSH_MCP_TELEMETRY_PATCH ?? join(telemetryRoot, "scripts/harness/dsh-telemetry.patch.yml");
const telemetryModule = process.env.DSH_MCP_TELEMETRY_MODULE ?? pathToFileURL(join(telemetryRoot, "scripts/harness/dsh-telemetry-headless.mjs")).href;
const telemetryLog = process.env.DSH_MCP_TELEMETRY_LOG ?? join(homedir(), ".codex/mcp/dsh/telemetry.jsonl");
let activeChild = null;

function telemetryAvailable() {
  try {
    return existsSync(telemetryPatch) && telemetryModule.startsWith("file:") &&
      existsSync(new URL(telemetryModule));
  } catch { return false; }
}

const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
function parseUsage(raw, runId) {
  if (!raw.endsWith("\n") || raw.trimEnd().includes("\n")) return null;
  try {
    const record = JSON.parse(raw);
    if (record.schema_version !== "0.1" || record.run_id !== runId ||
        record.source !== "dsh-session-provider-usage" || record.scope !== "root_turn") return null;
    const usage = record.usage;
    if (usage === null) return null;
    if (!usage || !isCount(usage.input_tokens) || !isCount(usage.uncached_input_tokens) ||
        !isCount(usage.output_tokens) || !isCount(usage.total_tokens) ||
        usage.input_tokens + usage.output_tokens !== usage.total_tokens ||
        usage.uncached_input_tokens > usage.input_tokens) return null;
    for (const key of ["cache_read_tokens", "cache_write_tokens", "reasoning_tokens"])
      if (usage[key] !== null && usage[key] !== undefined && !isCount(usage[key])) return null;
    if (usage.reasoning_tokens !== null && usage.reasoning_tokens !== undefined && usage.reasoning_tokens > usage.output_tokens) return null;
    if (usage.routes !== null && usage.routes !== undefined &&
        (!Array.isArray(usage.routes) || usage.routes.length > 8 || !usage.routes.every((route) =>
          typeof route.provider === "string" && route.provider.length <= 100 &&
          typeof route.model === "string" && route.model.length <= 100))) return null;
    return {
      input_tokens: usage.input_tokens,
      uncached_input_tokens: usage.uncached_input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens,
      cache_read_tokens: usage.cache_read_tokens ?? null,
      cache_write_tokens: usage.cache_write_tokens ?? null,
      reasoning_tokens: usage.reasoning_tokens ?? null,
      routes: usage.routes ?? null,
    };
  } catch { return null; }
}

function persistTelemetry(record) {
  try {
    appendFileSync(telemetryLog, JSON.stringify(record) + "\n", { encoding: "utf8", flag: "a" });
    return true;
  } catch { return false; }
}

function stopOwnedChild(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32") {
    spawnSync(join(process.env.SystemRoot ?? "C:/Windows", "System32/taskkill.exe"),
      ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 5000 });
  } else child.kill("SIGTERM");
}

function log(message) {
  process.stderr.write(`[${NAME}] ${message}\n`);
}

function findDsh() {
  const cli = process.env.DSH_CLI_PATH;
  if (!cli || !isAbsolute(cli) || !existsSync(cli)) return { args: null, version: null };
  const args = [process.execPath, cli];
  const probe = spawnSyncProbe([...args, "--version"]);
  if (probe.ok) return { args, version: probe.version };
  return { args: null, version: null };
}

function spawnSyncProbe(args) {
  const result = spawnSync(args[0], args.slice(1), { encoding: "utf8", timeout: 10000, windowsHide: true });
  if (result.status !== 0) return { ok: false, version: null };
  const version = (result.stdout ?? "").trim().split("\n")[0];
  return { ok: true, version: version || "unknown" };
}

const dsh = findDsh();

/** How long to wait after SIGTERM before escalating to SIGKILL. */
const GRACE_AFTER_SIGTERM_MS = 30 * 1000;

/** Run one dsh headless task; return text plus numeric, source-labeled telemetry. */
function runHeadless(task, cwd, timeoutMs, runId) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const startedMono = performance.now();
    const child = spawn(dsh.args[0], [...dsh.args.slice(1), "--profile", PROFILE, "--patch", telemetryPatch, task], {
      cwd: cwd || undefined,
      env: { ...process.env, DSH_HOME: dshHome, DSH_MCP_RUN_ID: runId, DSH_MCP_TELEMETRY_MODULE: telemetryModule },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "pipe"],
    });
    activeChild = child;
    let stdout = "";
    let outputExceeded = false;
    let settled = false;
    let timedOut = false;
    let timer = null;
    let killTimer = null;
    let telemetryRaw = "";
    let telemetryExceeded = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      activeChild = null;
      resolve({
        ...value,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        elapsed_seconds: Math.round((performance.now() - startedMono) * 1000) / 1000000,
        usage: telemetryExceeded ? null : parseUsage(telemetryRaw, runId),
      });
    };
    timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      // Graceful first: SIGTERM lets the dsh headless runner cancel the
      // in-flight turn and flush a terminal turn/end event, so the session
      // is not left looking stuck mid-stream. SIGKILL only as a last resort
      // after the grace window.
      log(`task timed out after ${timeoutMs} ms; sending SIGTERM to pid ${child.pid}, escalating to SIGKILL after ${GRACE_AFTER_SIGTERM_MS} ms`);
      try {
        stopOwnedChild(child);
      } catch (error) {
        log(`SIGTERM to pid ${child.pid} failed: ${error.message}`);
      }
      killTimer = setTimeout(() => {
        if (settled) return;
        try {
          child.kill("SIGKILL");
        } catch (error) {
          log(`SIGKILL to pid ${child.pid} failed: ${error.message}`);
        }
      }, GRACE_AFTER_SIGTERM_MS);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      if (outputExceeded) return;
      stdout += chunk.toString();
      if (stdout.length > MAX_OUTPUT_CHARS) {
        outputExceeded = true;
        stdout = "";
        stopOwnedChild(child);
      }
    });
    child.stdio[3].on("data", (chunk) => {
      if (telemetryExceeded) return;
      telemetryRaw += chunk.toString();
      if (telemetryRaw.length > MAX_TELEMETRY_CHARS) {
        telemetryExceeded = true;
        telemetryRaw = "";
      }
    });
    // Keep only a bounded in-memory tail for fixed-category failure diagnostics.
    // Never forward raw stderr: the headless runner can write reasoning there.
    let stderrTail = "";
    child.stderr.on("data", (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-8192);
    });
    child.on("error", (error) => {
      settle({ ok: false, code: null, timedOut: false, text: `DSH_START_FAILED (${error.code ?? "unknown"})` });
    });
    child.on("close", (code) => {
      const answer = stdout.trim();
      if (outputExceeded) {
        settle({ ok: false, code, timedOut: false, text: "DSH_OUTPUT_LIMIT_EXCEEDED" });
      } else if (timedOut) {
        // SIGTERM/SIGKILL path: report the deadline and include whatever the
        // runner managed to emit before termination.
        settle({
          ok: false,
          code,
          timedOut: true,
          text: `DSH_TIMEOUT after ${timeoutMs} ms; partial output withheld.`,
        });
      } else if (code === 0 && answer.length > 0) {
        settle({ ok: true, code, timedOut: false, text: answer });
      } else {
        // DSH writes reasoning to stderr too. Inspect only its terminal error code,
        // never the message or preceding reasoning, and return only fixed labels.
        const terminal = stderrTail.trimEnd().split(/\r?\n/).at(-1) ?? "";
        const match = /^dsh:\s+([A-Z][A-Z0-9_]{1,63}):\s/.exec(terminal);
        const errorCode = match?.[1] ?? "";
        let category = "unknown";
        if (errorCode === "MISSING_CREDENTIAL") category = "missing_credential";
        else if (errorCode === "AUTH" || errorCode === "INVALID_CREDENTIAL" || /^HTTP_40[13]$/.test(errorCode)) category = "authentication";
        else if (errorCode === "QUOTA" || errorCode === "RATE_LIMIT" || errorCode === "HTTP_429") category = "quota";
        else if (errorCode === "TRANSPORT" || errorCode === "TIMEOUT") category = "network";
        else if (errorCode === "ABORTED") category = "aborted";
        else if (errorCode === "CONTEXT_WINDOW_EXCEEDED" || errorCode === "INVALID_REQUEST" || errorCode === "REQUEST_EXTENSION") category = "request";
        else if (errorCode === "SERVER" || errorCode === "STREAM_CLOSED" || errorCode === "MALFORMED_RESPONSE" || errorCode === "EMPTY_RESPONSE" || /^HTTP_5\d\d$/.test(errorCode)) category = "provider_or_runner";
        settle({
          ok: false,
          code,
          timedOut: false,
          text: `DSH_RUN_FAILED (exit=${code}; category=${category}); raw diagnostics withheld.`,
        });
      }
    });
  });
}

const tools = [
  {
    name: "dsh_delegate",
    description:
      "Run one task through DeepSeek Harness headless (`dsh --profile headless`) and return the final assistant text. Use for delegating a self-contained coding, research, or analysis task to the DeepSeek-powered agent. One task per call; results are the committed final answer, not a live transcript.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", minLength: 1, maxLength: MAX_TASK_CHARS, description: "Self-contained task, necessary context, constraints and acceptance criteria. Never include credentials." },
        cwd: {
          type: "string",
          description: "Absolute workspace root, allowed by dsh_health.",
        },
        timeout_ms: {
          type: "integer",
          description: `Optional timeout in milliseconds. Default ${DEFAULT_TIMEOUT_MS}.`,
          default: DEFAULT_TIMEOUT_MS,
          minimum: 1000,
          maximum: DEFAULT_TIMEOUT_MS,
        },
      },
      required: ["task", "cwd"],
      additionalProperties: false,
    },
  },
  {
    name: "dsh_health",
    description: "Report DeepSeek Harness availability: launcher path, version, profile presence, and DSH_HOME.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

function health() {
  const profileManifest = join(dshHome, "profiles", PROFILE, "package.json");
  return {
    ok: dsh.args !== null,
    version: dsh.version,
    dsh_home: dshHome,
    profile: PROFILE,
    profile_present: existsSync(profileManifest),
    allowed_workspaces: allowedWorkspaces,
    delegation_contract: ["task", "cwd", "timeout_ms"],
    max_iterations_enforced_by_bridge: false,
    sandbox_policy: "Provided by DSH profile; not a per-call MCP parameter.",
    acp_profile_present: existsSync(join(dshHome, "profiles", "acp", "package.json")),
    telemetry: {
      enabled: telemetryAvailable(),
      source: "dsh-session-provider-usage",
      scope: "root_turn",
      duration_source: "bridge-monotonic-clock",
      cost_available: false,
    },
  };
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return; // not JSON-RPC on stdin; ignore
  }
  void handle(request);
});

async function handle(request) {
  const { id, method, params } = request ?? {};
  if (id === undefined) {
    if (method === "notifications/cancelled" && activeChild?.requestId === params?.requestId) stopOwnedChild(activeChild);
    return;
  }
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: MCP_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: NAME, version: VERSION },
      },
    });
    return;
  }
  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools } });
    return;
  }
  if (method === "tools/call") {
    const toolName = params?.name;
    const args = params?.arguments ?? {};
    let content;
    let isError = false;
    let telemetry = null;
    try {
      if (toolName === "dsh_delegate") {
        if (Object.keys(args).some((key) => !["task", "cwd", "timeout_ms"].includes(key))) throw new Error("UNSUPPORTED_ARGUMENTS");
        if (dsh.args === null) {
          content = "dsh is not installed. Run: npm install -g @deepseek-ai/dsh (Node.js >= 22.15).";
          isError = true;
        } else if (!telemetryAvailable()) {
          content = "DSH_TELEMETRY_OVERLAY_MISSING";
          isError = true;
        } else if (typeof args.task !== "string" || args.task.trim() === "" || args.task.length > MAX_TASK_CHARS) {
          content = "`task` must be a non-empty string.";
          isError = true;
        } else {
          if (activeChild) throw new Error("DSH_BUSY");
          if (typeof args.cwd !== "string" || !isAbsolute(args.cwd)) throw new Error("INVALID_WORKSPACE");
          let canonical;
          try { canonical = realpathSync(args.cwd); } catch { throw new Error("INVALID_WORKSPACE"); }
          if (!statSync(canonical).isDirectory() || !allowedWorkspaces.includes(workspaceKey(canonical))) throw new Error("WORKSPACE_NOT_ALLOWED");
          const timeoutMs = args.timeout_ms ?? DEFAULT_TIMEOUT_MS;
          if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > DEFAULT_TIMEOUT_MS) throw new Error("INVALID_TIMEOUT");
          const runId = randomUUID();
          const pending = runHeadless(args.task.trim(), canonical, timeoutMs, runId);
          if (activeChild) activeChild.requestId = id;
          const result = await pending;
          content = result.text;
          isError = !result.ok;
          const record = {
            schema_version: "0.1",
            run_id: runId,
            task_sha256: createHash("sha256").update(args.task.trim()).digest("hex"),
            workspace: canonical,
            started_at: result.started_at,
            finished_at: result.finished_at,
            elapsed_seconds: result.elapsed_seconds,
            status: result.ok ? "completed" : result.timedOut ? "timeout" : "failed",
            runner_exit_code: result.code,
            usage: result.usage,
            usage_source: result.usage ? "dsh-session-provider-usage" : "unavailable",
            usage_scope: "root_turn",
            cost: null,
            cost_source: "unavailable",
          };
          telemetry = { ...record, persisted: persistTelemetry(record) };
        }
      } else if (toolName === "dsh_health") {
        if (Object.keys(args).length) throw new Error("UNSUPPORTED_ARGUMENTS");
        content = JSON.stringify(health(), null, 2);
      } else {
        content = `unknown tool: ${toolName}`;
        isError = true;
      }
    } catch (error) {
      content = `tool error: ${error.message}`;
      isError = true;
    }
    const blocks = [{ type: "text", text: content }];
    if (telemetry) blocks.push({ type: "text", text: `C360_TELEMETRY_V1 ${JSON.stringify(telemetry)}` });
    send({
      jsonrpc: "2.0",
      id,
      result: { content: blocks, isError, ...(telemetry ? { structuredContent: { telemetry } } : {}) },
    });
    return;
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
}

rl.on("close", () => stopOwnedChild(activeChild));
log(`ready (DSH available: ${dsh.args !== null}, profile=${PROFILE})`);
