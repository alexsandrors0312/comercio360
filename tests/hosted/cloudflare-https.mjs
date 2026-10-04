// Explicitly opt-in HTTPS probe. The wrapper supplies project keys in memory.
// Never print credentials, cookies, signed URLs, object paths or provider bodies.
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const PROJECT = "qiwblpmocldqbijbylwg";
const SUPABASE = "https://" + PROJECT + ".supabase.co";
const WORKER = "https://comercio360.alexsandrors-0312.workers.dev";
const ORG = "10000000-0000-4000-8000-000000000001";
const STORE = "10000000-0000-4000-8000-000000000011";
const OTHER_STORE = "10000000-0000-4000-8000-000000000012";
const BUCKET = "catalog-private";
console.warn = () => console.log("SDK: aviso sensível omitido.");
console.error = () => console.log("SDK: diagnóstico sensível omitido.");
const fixture = { userId: null, membershipId: null, productId: null };
let admin;
let browser;
let current = "preflight";
let failed = false;

function check(condition) {
  if (!condition) throw new Error("probe assertion");
}
function value(response) {
  check(response && !response.error && response.data);
  return response.data;
}
async function stage(name, operation) {
  current = name;
  await operation();
  console.log("PASS: " + name);
}
async function remove(table, column, id) {
  if (!id) return;
  const result = await admin.from(table).delete().eq(column, id);
  check(!result.error);
}
async function revision() {
  const row = value(
    await admin
      .from("products")
      .select("revision")
      .eq("id", fixture.productId)
      .single(),
  );
  return String(row.revision);
}
function endpoint() {
  return WORKER + "/api/catalog/images/" + fixture.productId;
}
function multipart(bytes, expectedRevision) {
  return {
    organizationId: ORG,
    storeId: STORE,
    expectedRevision,
    file: { name: "fixture.jpg", mimeType: "image/jpeg", buffer: bytes },
  };
}
function deletion(expectedRevision) {
  return { organizationId: ORG, storeId: STORE, expectedRevision };
}

try {
  check(process.env.NEXT_PUBLIC_SUPABASE_URL === SUPABASE);
  check(process.env.CATALOG_HTTPS_WORKER_URL === WORKER);
  check(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.startsWith(
      "sb_publishable_",
    ),
  );
  check(process.env.SUPABASE_SECRET_KEY?.length > 100);
  const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  };
  admin = createClient(SUPABASE, process.env.SUPABASE_SECRET_KEY, options);
  for (const name of [
    "SUPABASE_SECRET_KEY", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD",
  ]) delete process.env[name];
  const unique = randomUUID();
  const email = "catalog.https." + unique + "@example.test";
  const password = randomBytes(32).toString("base64url");

  await stage("Conta e produto fictícios temporários", async () => {
    const created = value(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      }),
    );
    fixture.userId = created.user?.id;
    check(fixture.userId);
    value(
      await admin
        .from("profiles")
        .insert({
          id: fixture.userId,
          display_name: "HTTPS probe",
        })
        .select("id")
        .single(),
    );
    const member = value(
      await admin
        .from("memberships")
        .insert({
          organization_id: ORG,
          user_id: fixture.userId,
          role: "manager",
        })
        .select("id")
        .single(),
    );
    fixture.membershipId = member.id;
    value(
      await admin
        .from("user_store_access")
        .insert({
          organization_id: ORG,
          membership_id: fixture.membershipId,
          store_id: STORE,
        })
        .select("id")
        .single(),
    );
    value(
      await admin
        .from("user_store_access")
        .insert({
          organization_id: ORG,
          membership_id: fixture.membershipId,
          store_id: OTHER_STORE,
        })
        .select("id")
        .single(),
    );
    const product = value(
      await admin
        .from("products")
        .insert({
          organization_id: ORG,
          name: "Cloudflare HTTPS probe " + unique.slice(0, 8),
        })
        .select("id")
        .single(),
    );
    fixture.productId = product.id;
  });

  const browserEnv = {};
  for (const name of [
    "PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP",
    "USERPROFILE", "LOCALAPPDATA", "APPDATA", "HOME",
  ]) {
    if (process.env[name]) browserEnv[name] = process.env[name];
  }
  browser = await chromium.launch({ headless: true, env: browserEnv });
  const context = await browser.newContext();
  const page = await context.newPage();
  await stage("Login publicado e cookies Secure", async () => {
    const opened = await page.goto(WORKER + "/login", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    check(opened?.status() === 200);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: "Entrar na minha loja" }).click();
    await page.waitForURL((url) => url.pathname.startsWith("/app/"), {
      timeout: 45000,
    });
    const cookies = await context.cookies(WORKER);
    const authCookies = cookies.filter(
      (cookie) =>
        cookie.name.startsWith("sb-") && cookie.name.includes("auth-token"),
    );
    check(
      authCookies.length > 0 && authCookies.every((cookie) => cookie.secure),
    );
    check(new URL(page.url()).origin === WORKER);
  });
  await stage("Seleção da segunda loja em HTTPS", async () => {
    await page.getByRole("combobox", { name: "Loja" }).selectOption(OTHER_STORE);
    await page.getByRole("button", { name: "Aplicar" }).click();
    await page.waitForURL((url) => url.pathname === "/app/visao-geral", {
      timeout: 45000,
    });
  });
  await stage("Cookie da loja selecionada emitido", async () => {
    let selected;
    for (let attempt = 0; attempt < 100; attempt++) {
      selected = (await context.cookies(WORKER)).find(
        (cookie) => cookie.name === "c360-store",
      );
      if (selected?.value === OTHER_STORE) break;
      await page.waitForTimeout(200);
    }
    check(selected?.value === OTHER_STORE);
  });
  await stage("Cookie de contexto Secure e HttpOnly", async () => {
    const selected = (await context.cookies(WORKER)).find(
      (cookie) => cookie.name === "c360-store",
    );
    check(selected?.secure && selected.httpOnly);
  });
  await stage("Loja persiste após recarga HTTPS", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    check(
      (await page.getByRole("combobox", { name: "Loja" }).inputValue()) ===
        OTHER_STORE,
    );
  });
  const request = context.request;
  const noRedirect = { maxRedirects: 0, timeout: 45000 };
  const originalRevision = await revision();
  await stage("Leitura inicial e negação anônima", async () => {
    const initial = await request.get(
      endpoint() +
        "?" +
        new URLSearchParams({ organizationId: ORG, storeId: STORE }),
      noRedirect,
    );
    check(initial.status() === 404);
    const anonymous = await browser.newContext();
    try {
      const denied = await anonymous.request.get(
        endpoint() +
          "?" +
          new URLSearchParams({ organizationId: ORG, storeId: STORE }),
        noRedirect,
      );
      check(denied.status() === 403);
    } finally {
      await anonymous.close();
    }
  });
  const bytes = await sharp({
    create: { width: 24, height: 16, channels: 3, background: "#557799" },
  })
    .jpeg()
    .withExif({ IFD0: { Copyright: "temporary fixture" } })
    .toBuffer();
  check((await sharp(bytes).metadata()).exif);
  await stage("Origem externa e arquivo inválido rejeitados", async () => {
    const foreign = await request.post(endpoint(), {
      ...noRedirect,
      headers: { Origin: "https://example.invalid" },
      multipart: multipart(bytes, originalRevision),
    });
    check(foreign.status() === 403);
    const invalid = await request.post(endpoint(), {
      ...noRedirect,
      headers: { Origin: WORKER },
      multipart: multipart(Buffer.from("not an image"), originalRevision),
    });
    check(invalid.status() === 400);
  });
  await stage("POST reencoda JPEG e GET lê capa privada sem EXIF", async () => {
    const uploaded = await request.post(endpoint(), {
      ...noRedirect,
      headers: { Origin: WORKER },
      multipart: multipart(bytes, originalRevision),
    });
    check(
      uploaded.status() === 200 && (await uploaded.json()).status === "success",
    );
    const get = await request.get(
      endpoint() +
        "?" +
        new URLSearchParams({ organizationId: ORG, storeId: STORE }),
      noRedirect,
    );
    check(
      get.status() === 302 &&
        get.headers()["cache-control"]?.includes("no-store"),
    );
    const location = get.headers().location;
    check(
      location?.startsWith(
        SUPABASE + "/storage/v1/object/sign/" + BUCKET + "/",
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
  });
  await stage("409 preserva capa em revisão antiga", async () => {
    const before = value(
      await admin
        .from("product_images")
        .select("object_id")
        .eq("product_id", fixture.productId)
        .single(),
    );
    const stale = await request.post(endpoint(), {
      ...noRedirect,
      headers: { Origin: WORKER },
      multipart: multipart(bytes, originalRevision),
    });
    check(stale.status() === 409 && (await stale.json()).status === "conflict");
    const after = value(
      await admin
        .from("product_images")
        .select("object_id")
        .eq("product_id", fixture.productId)
        .single(),
    );
    check(before.object_id === after.object_id);
  });
  await stage("403 após perda de papel ou vínculo", async () => {
    check(
      !(
        await admin
          .from("memberships")
          .update({ role: "cashier" })
          .eq("id", fixture.membershipId)
      ).error,
    );
    const read = await request.get(
      endpoint() +
        "?" +
        new URLSearchParams({ organizationId: ORG, storeId: STORE }),
      noRedirect,
    );
    check(read.status() === 302);
    const write = await request.post(endpoint(), {
      ...noRedirect,
      headers: { Origin: WORKER },
      multipart: multipart(bytes, await revision()),
    });
    check(write.status() === 403);
    check(
      !(
        await admin
          .from("memberships")
          .update({ active: false })
          .eq("id", fixture.membershipId)
      ).error,
    );
    const denied = await request.get(
      endpoint() +
        "?" +
        new URLSearchParams({ organizationId: ORG, storeId: STORE }),
      noRedirect,
    );
    check(denied.status() === 403);
    check(
      !(
        await admin
          .from("memberships")
          .update({
            role: "manager",
            active: true,
          })
          .eq("id", fixture.membershipId)
      ).error,
    );
  });
  await stage("DELETE com CAS e GET final 404", async () => {
    const stale = await request.delete(endpoint(), {
      ...noRedirect,
      headers: { Origin: WORKER },
      data: deletion(originalRevision),
    });
    check(stale.status() === 409);
    const removed = await request.delete(endpoint(), {
      ...noRedirect,
      headers: { Origin: WORKER },
      data: deletion(await revision()),
    });
    check(
      removed.status() === 200 && (await removed.json()).status === "success",
    );
    const missing = await request.get(
      endpoint() +
        "?" +
        new URLSearchParams({ organizationId: ORG, storeId: STORE }),
      noRedirect,
    );
    check(missing.status() === 404);
  });
  await stage("Logout limpa sessão e bloqueia página privada", async () => {
    await page.getByRole("button", { name: /Sair/ }).click();
    await page.waitForURL((url) => url.pathname === "/login", {
      timeout: 45000,
    });
    const cookies = await context.cookies(WORKER);
    check(!cookies.some((cookie) =>
      cookie.name === "c360-store" ||
      cookie.name === "c360-org" ||
      (cookie.name.startsWith("sb-") && cookie.name.includes("auth-token")),
    ));
    await page.goto(WORKER + "/app/visao-geral", {
      waitUntil: "domcontentloaded", timeout: 45000,
    });
    check(new URL(page.url()).pathname === "/login");
  });
} catch {
  failed = true;
  console.log("FAIL: " + current + ". Diagnóstico sensível omitido.");
} finally {
  if (browser)
    await browser.close().catch(() => {
      failed = true;
    });
  let cleanupFailed = false;
  if (admin) {
    try {
      if (fixture.productId) {
        const ledger = value(
          await admin
            .from("catalog_image_objects")
            .select("object_path")
            .eq("product_id", fixture.productId),
        );
        for (const row of ledger) {
          const gone = await admin.storage
            .from(BUCKET)
            .remove([row.object_path]);
          check(!gone.error);
        }
      }
      await remove("product_images", "product_id", fixture.productId);
      await remove("catalog_image_objects", "product_id", fixture.productId);
      await remove("products", "id", fixture.productId);
      await remove("user_store_access", "membership_id", fixture.membershipId);
      await remove("memberships", "id", fixture.membershipId);
      await remove("profiles", "id", fixture.userId);
      if (fixture.userId)
        check(!(await admin.auth.admin.deleteUser(fixture.userId)).error);
    } catch {
      cleanupFailed = true;
      if (fixture.membershipId) {
        const revoke = await admin
          .from("memberships")
          .update({ active: false })
          .eq("id", fixture.membershipId)
          .select("active")
          .single();
        if (revoke.error || revoke.data?.active !== false)
          console.log("FAIL: revogação da conta de teste não confirmada.");
      }
    }
  }
  console.log(
    (cleanupFailed ? "FAIL" : "PASS") + ": limpeza das fixtures temporárias",
  );
  process.exitCode = failed || cleanupFailed ? 1 : 0;
}
