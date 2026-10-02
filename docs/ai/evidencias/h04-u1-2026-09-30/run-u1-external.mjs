import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const arm = process.argv[2];
if (!["codex", "dsh"].includes(arm)) throw new Error("Usage: node run-u1-external.mjs codex|dsh [focused|full]");
const scope = process.argv[3] ?? "focused";
if (!["focused", "full"].includes(scope)) throw new Error("Scope must be focused or full");
const workspace = `C:/Users/Alexs/AppData/Local/Temp/h04-u1-78223936cb97431ea3d9dc282179834e/${arm}`;
const parent = "C:/Users/Alexs/AppData/Local/Temp/h04-u1-78223936cb97431ea3d9dc282179834e";
const config = join(parent, "playwright-u1-external.config.mjs");
const owned = [];

async function isListening(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitHealth(url, child, label) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} exited before health: ${child.exitCode}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        console.log(`${new Date().toISOString()} HEALTH ${label} ${response.status}`);
        return;
      }
    } catch {}
    await delay(300);
  }
  throw new Error(`${label} health timeout`);
}

function start(label, executable, args, env = process.env) {
  const child = spawn(executable, args, {
    cwd: workspace,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutLog = createWriteStream(join(parent, `u1-${arm}-${scope}-${label}.stdout.log`));
  const stderrLog = createWriteStream(join(parent, `u1-${arm}-${scope}-${label}.stderr.log`));
  child.stdout.pipe(stdoutLog);
  child.stderr.pipe(stderrLog);
  owned.push({ label, child, stdoutLog, stderrLog });
  console.log(`${new Date().toISOString()} START ${label} pid=${child.pid}`);
  return child;
}

async function stop({ label, child, stdoutLog, stderrLog }) {
  if (child.exitCode === null && child.signalCode === null && child.pid) {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    killer.stdout.on("data", (chunk) => { output += chunk.toString(); });
    killer.stderr.on("data", (chunk) => { output += chunk.toString(); });
    const status = await new Promise((resolve) => killer.once("close", resolve));
    console.log(`${new Date().toISOString()} STOP ${label} pid=${child.pid} taskkill=${status} ${output.trim()}`);
    if (status !== 0 && child.exitCode === null && child.signalCode === null) {
      const sent = child.kill();
      console.log(`${new Date().toISOString()} FALLBACK_STOP ${label} pid=${child.pid} signal_sent=${sent}`);
    }
  }
  stdoutLog.end();
  stderrLog.end();
}

let exitCode = 1;
try {
  if (await isListening(3001) || await isListening(54329)) {
    throw new Error("Port 3001 or 54329 is already listening; refusing to use or stop an unknown process.");
  }
  const auth = start("auth", process.execPath, [join(workspace, "tests/support/auth-server.mjs")]);
  await waitHealth("http://127.0.0.1:54329/health", auth, "auth");
  const next = start(
    "next",
    process.execPath,
    [join(workspace, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3001"],
    {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54329",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-test-key",
      DEMO_ENABLED: "true",
      NEXT_DIST_DIR: ".next-e2e",
    },
  );
  await waitHealth("http://127.0.0.1:3001/login", next, "next");
  const runner = start(
    "playwright",
    process.execPath,
    [
      join(workspace, "node_modules/playwright/cli.js"),
      "test",
      "tests/e2e/foundation.spec.ts",
      "--config",
      config,
      ...(scope === "focused" ? ["--grep", "mobile menu toggles|protected routes require"] : []),
      "--reporter",
      "list",
    ],
    { ...process.env, H04_U1_ARM: arm },
  );
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve("timeout"), 120000);
  });
  const completed = new Promise((resolve) => runner.once("close", (code) => resolve(code)));
  const outcome = await Promise.race([completed, timeout]);
  clearTimeout(timeoutId);
  if (outcome === "timeout") {
    console.log(`${new Date().toISOString()} PLAYWRIGHT_TIMEOUT`);
    exitCode = 124;
  } else {
    exitCode = outcome ?? 1;
    console.log(`${new Date().toISOString()} PLAYWRIGHT_EXIT ${exitCode}`);
  }
} catch (error) {
  console.error(`${new Date().toISOString()} ERROR ${error.message}`);
} finally {
  for (const process of owned.reverse()) await stop(process);
  let portsFree = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    portsFree = !(await isListening(3001)) && !(await isListening(54329));
    if (portsFree) break;
    await delay(250);
  }
  console.log(`${new Date().toISOString()} CLEANUP_PORTS_FREE ${portsFree}`);
  if (!portsFree && exitCode === 0) exitCode = 1;
  process.exitCode = exitCode;
}
