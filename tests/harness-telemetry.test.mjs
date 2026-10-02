import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { firstCompleteTurnEvents } from "../scripts/harness/telemetry-turn-events.mjs";

const bridge = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts/harness/dsh-mcp-telemetry.mjs");

test("usage aggregation receives only the complete turn, excluding prelude and tail", () => {
  const prelude = { type: "user/message" };
  const start = { type: "turn/start" };
  const sample = { type: "assistant/message" };
  const end = { type: "turn/end" };
  assert.deepEqual(firstCompleteTurnEvents([prelude, start, sample, end, prelude]), [start, sample, end]);
  assert.deepEqual(firstCompleteTurnEvents([prelude, start, sample]), []);
});
const fakeCliSource = `import { writeSync } from "node:fs";
if (process.argv.includes("--version")) {
  process.stdout.write("0.1.5-rc.3\\n");
} else {
  const scenario = process.argv.at(-1);
  process.stderr.write("dsh: reasoning:\\nprivate thought\\n");
  if (scenario !== "missing") {
    const usage = {
      input_tokens: 11, uncached_input_tokens: 7, output_tokens: 4,
      total_tokens: 15, cache_read_tokens: 4, cache_write_tokens: 0,
      reasoning_tokens: 2, routes: [{ provider: "fixture", model: "fixture-model" }],
    };
    if (scenario === "invalid") usage.total_tokens = 99;
    writeSync(3, JSON.stringify({
      schema_version: "0.1", run_id: process.env.DSH_MCP_RUN_ID,
      source: "dsh-session-provider-usage", scope: "root_turn", usage,
    }) + "\\n");
  }
  process.stdout.write("fixture final\\n");
  if (scenario === "failed") process.exitCode = 1;
}
`;

test("bridge captures provider usage, duration and unavailable states without raw reasoning", async () => {
  const root = mkdtempSync(join(tmpdir(), "c360-telemetry-"));
  const safeRoot = realpathSync(root);
  assert.ok(safeRoot.startsWith(realpathSync(tmpdir())));
  const cli = join(root, "fake-cli.mjs");
  const dshHome = join(root, "dsh");
  const patch = join(root, "scripts", "harness", "dsh-telemetry.patch.yml");
  const headlessModule = join(root, "scripts", "harness", "dsh-telemetry-headless.mjs");
  const log = join(root, "telemetry.jsonl");
  mkdirSync(join(dshHome, "profiles", "headless"), { recursive: true });
  mkdirSync(dirname(patch), { recursive: true });
  writeFileSync(join(dshHome, "profiles", "headless", "package.json"), "{}");
  writeFileSync(cli, fakeCliSource);
  writeFileSync(patch, "[]\n");
  writeFileSync(headlessModule, "export const name = 'fixture';\n");

  const child = spawn(process.execPath, [bridge], {
    cwd: tmpdir(),
    windowsHide: true,
    env: {
      ...process.env,
      DSH_CLI_PATH: cli,
      DSH_HOME: dshHome,
      DSH_MCP_PROFILE: "headless",
      DSH_MCP_ALLOWED_WORKSPACES: JSON.stringify([root]),
      DSH_MCP_TELEMETRY_LOG: log,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  child.stderr.resume();
  let nextId = 1;
  function rpc(method, params = {}) {
    const id = nextId++;
    return new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error(`MCP ${method} timed out`)), 10000);
      pending.set(id, (message) => { clearTimeout(timer); done(message); });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  try {
    const init = await rpc("initialize");
    assert.equal(init.result.serverInfo.version, "0.1.0-c360.2");
    const health = await rpc("tools/call", { name: "dsh_health", arguments: {} });
    assert.equal(JSON.parse(health.result.content[0].text).telemetry.enabled, true);
    for (const scenario of ["valid", "missing", "invalid", "failed"]) {
      const response = await rpc("tools/call", {
        name: "dsh_delegate",
        arguments: { task: scenario, cwd: root },
      });
      assert.equal(response.result.content[0].text.includes("private thought"), false);
      const block = response.result.content[1].text;
      assert.ok(block.startsWith("C360_TELEMETRY_V1 "));
      const telemetry = JSON.parse(block.slice("C360_TELEMETRY_V1 ".length));
      assert.ok(telemetry.elapsed_seconds >= 0);
      assert.equal(telemetry.cost, null);
      assert.equal(telemetry.persisted, true);
      assert.equal(telemetry.task_sha256.length, 64);
      assert.equal(response.result.structuredContent.telemetry.run_id, telemetry.run_id);
      if (scenario === "valid" || scenario === "failed") {
        assert.equal(telemetry.usage.input_tokens, 11);
        assert.equal(telemetry.usage.output_tokens, 4);
        assert.equal(telemetry.usage_source, "dsh-session-provider-usage");
      } else {
        assert.equal(telemetry.usage, null);
        assert.equal(telemetry.usage_source, "unavailable");
      }
      assert.equal(response.result.isError, scenario === "failed");
    }
    const records = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(records.length, 4);
    assert.ok(records.every((record) => !Object.hasOwn(record, "task")));
    assert.equal(readFileSync(log, "utf8").includes("private thought"), false);
  } finally {
    child.stdin.end();
    lines.close();
    if (child.exitCode === null) child.kill();
    assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir())));
    rmSync(root, { recursive: true, force: true });
  }
});
