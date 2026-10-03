import { spawn, execFile } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createServerClient } from "@supabase/ssr";
import sharp from "sharp";

function check(condition) {
  if (!condition) throw new Error("hosted Next assertion");
}

function statusIs(response, expected, label) {
  if (response.status !== expected)
    console.log(
      `Next diagnostic: ${label} expected=${expected}, http=${response.status}`,
    );
  check(response.status === expected);
}

async function freePort() {
  const socket = createServer();
  await new Promise((resolve, reject) =>
    socket.listen(0, "127.0.0.1", resolve).on("error", reject),
  );
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function stopOwnedServer(child) {
  if (!Number.isInteger(child.pid)) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    await new Promise((resolve, reject) =>
      execFile(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true },
        (error) =>
          error && child.exitCode === null
            ? reject(new Error("owned Next shutdown failed"))
            : resolve(),
      ),
    );
  } else {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      delay(5000),
    ]);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }
}

// The admin client stays in the test parent. The Next child receives only the
// public project key and the temporary attestation key required by its endpoint.
export async function verifyHostedNext({
  projectUrl,
  publicKey,
  attestationKey,
  email,
  password,
  organizationId,
  storeId,
  productId,
  membershipId,
  admin,
  stage,
}) {
  check(
    [".env", ".env.local", ".env.development", ".env.development.local"].every(
      (path) => !existsSync(path),
    ),
  );
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const path = `/api/catalog/images/${productId}`;
  const query = new URLSearchParams({ organizationId, storeId });
  const env = {};
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "COMSPEC",
    "PATHEXT",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
  ])
    if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, {
    NEXT_PUBLIC_SUPABASE_URL: projectUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey,
    CATALOG_IMAGE_ATTESTATION_KEY: attestationKey,
    NEXT_DIST_DIR: ".next-e2e",
    NEXT_TELEMETRY_DISABLED: "1",
  });
  const child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: process.cwd(),
      env,
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore"],
    },
  );
  let bootError = false;
  child.on("error", () => {
    bootError = true;
  });
  const jar = new Map();
  const session = createServerClient(projectUrl, publicKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (values) =>
        values.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const cookie = () =>
    [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  const fetchNext = (route, options = {}) =>
    fetch(origin + route, {
      ...options,
      redirect: "manual",
      signal: AbortSignal.timeout(45000),
      headers: { Cookie: cookie(), Origin: origin, ...options.headers },
    });
  const currentRevision = async () => {
    const result = await admin
      .from("products")
      .select("revision")
      .eq("id", productId)
      .single();
    check(!result.error && result.data);
    return String(result.data.revision);
  };
  const multipart = (bytes, revision) => {
    const form = new FormData();
    form.set("organizationId", organizationId);
    form.set("storeId", storeId);
    form.set("expectedRevision", revision);
    form.set("file", new Blob([bytes], { type: "image/png" }), "fixture.png");
    return form;
  };
  const deletion = (revision) => ({
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      organizationId,
      storeId,
      expectedRevision: revision,
    }),
  });
  let originalRevision;
  try {
    await stage("Next local com Auth real e cookies SSR", async () => {
      const login = await session.auth.signInWithPassword({ email, password });
      check(!login.error && login.data.session && jar.size > 0);
      let ready = false;
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline && !ready) {
        check(!bootError && child.exitCode === null);
        try {
          const response = await fetch(origin + path + "?" + query, {
            redirect: "manual",
            signal: AbortSignal.timeout(10000),
          });
          ready = response.status === 403;
        } catch {
          /* Next can still be compiling the first route. */
        }
        if (!ready) await delay(500);
      }
      check(ready);
      const authorized = await fetchNext(path + "?" + query);
      if (authorized.status !== 404) {
        const body = await authorized
          .clone()
          .json()
          .catch(() => ({}));
        const cause =
          body?.message === "Acesso negado."
            ? "access"
            : body?.message === "Origem inválida."
              ? "origin"
              : "other";
        console.log(
          `Next diagnostic: cookie_read expected=404, http=${authorized.status}, cause=${cause}`,
        );
      }
      check(authorized.status === 404);
      originalRevision = await currentRevision();
    });
    await stage(
      "Endpoint Next rejeita origem externa e conteúdo falso",
      async () => {
        const invalid = Buffer.from("not an image");
        const foreign = await fetchNext(path, {
          method: "POST",
          headers: { Origin: "https://example.invalid" },
          body: multipart(invalid, originalRevision),
        });
        statusIs(foreign, 403, "foreign_origin");
        const malformed = await fetchNext(path, {
          method: "POST",
          body: multipart(invalid, originalRevision),
        });
        statusIs(malformed, 400, "malformed_file");
      },
    );
    const bytes = await sharp({
      create: { width: 24, height: 16, channels: 3, background: "#557799" },
    })
      .jpeg()
      .withExif({ IFD0: { Copyright: "fictitious hosted fixture" } })
      .toBuffer();
    await stage(
      "Endpoint Next reencoda imagem e remove EXIF no Storage real",
      async () => {
        const response = await fetchNext(path, {
          method: "POST",
          body: multipart(bytes, originalRevision),
        });
        check(
          response.status === 200 &&
            (await response.json()).status === "success",
        );
        const get = await fetchNext(path + "?" + query);
        check(
          get.status === 302 &&
            get.headers.get("cache-control")?.includes("no-store"),
        );
        const location = get.headers.get("location");
        check(
          location?.startsWith(
            projectUrl + "/storage/v1/object/sign/catalog-private/",
          ),
        );
        const stored = await fetch(location, {
          signal: AbortSignal.timeout(30000),
        });
        check(stored.ok);
        const metadata = await sharp(
          Buffer.from(await stored.arrayBuffer()),
        ).metadata();
        check(
          metadata.format === "jpeg" &&
            metadata.width === 24 &&
            metadata.height === 16 &&
            !metadata.exif,
        );
      },
    );
    await stage(
      "Endpoint Next devolve 409 e preserva capa em revisão obsoleta",
      async () => {
        const before = await admin
          .from("product_images")
          .select("object_id")
          .eq("product_id", productId)
          .single();
        check(!before.error && before.data);
        const stale = await fetchNext(path, {
          method: "POST",
          body: multipart(bytes, originalRevision),
        });
        check(
          stale.status === 409 && (await stale.json()).status === "conflict",
        );
        const after = await admin
          .from("product_images")
          .select("object_id")
          .eq("product_id", productId)
          .single();
        check(!after.error && before.data.object_id === after.data.object_id);
      },
    );
    await stage(
      "Endpoint Next revalida papel e vínculo na sessão aberta",
      async () => {
        let change = await admin
          .from("memberships")
          .update({ role: "cashier" })
          .eq("id", membershipId);
        check(!change.error);
        check((await fetchNext(path + "?" + query)).status === 302);
        check(
          (
            await fetchNext(path, {
              method: "POST",
              body: multipart(bytes, await currentRevision()),
            })
          ).status === 403,
        );
        change = await admin
          .from("memberships")
          .update({ active: false })
          .eq("id", membershipId);
        check(!change.error);
        check((await fetchNext(path + "?" + query)).status === 403);
        change = await admin
          .from("memberships")
          .update({ role: "manager", active: true })
          .eq("id", membershipId);
        check(!change.error);
      },
    );
    await stage(
      "Endpoint Next remove capa com CAS e leitura passa a 404",
      async () => {
        check(
          (await fetchNext(path, deletion(originalRevision))).status === 409,
        );
        const response = await fetchNext(
          path,
          deletion(await currentRevision()),
        );
        check(
          response.status === 200 &&
            (await response.json()).status === "success",
        );
        check((await fetchNext(path + "?" + query)).status === 404);
      },
    );
  } finally {
    await stopOwnedServer(child);
  }
}
