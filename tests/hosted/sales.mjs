// Opt-in only through scripts/sales-hosted.ps1. Sessions and provider bodies
// remain in memory; the report exports only fixed phase names and booleans.
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import { resolve, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium, expect } from "@playwright/test";

const PROJECT = "https://qiwblpmocldqbijbylwg.supabase.co";
const WORKER = "https://comercio360.alexsandrors-0312.workers.dev";
const ORG = "10000000-0000-4000-8000-000000000001";
const STORE = "10000000-0000-4000-8000-000000000011";
const FOREIGN_STORE = "20000000-0000-4000-8000-000000000011";
const SCOPE = { p_organization_id: ORG, p_store_id: STORE };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SALES_PHASES = [
  "configuration",
  "existing_login",
  "catalog_purchase_fixtures",
  "browser_sale",
  "browser_inventory",
  "rest_snapshot_replay",
  "rest_price_conflict",
  "rest_multiline_rollback",
  "rest_parallel_last_item",
  "rest_parallel_same_key",
  "rest_isolation",
  "browser_cashier",
  "browser_cancel",
  "rest_parallel_cancel",
  "postflight_compensation",
  "postflight_archive",
];
const check = (condition) => {
  if (!condition) throw new Error("sales probe failed");
};
export function assessSaleRace(responses, sameKey = false) {
  check(Array.isArray(responses) && responses.length === 2);
  const good = responses.filter(
    (r) =>
      r?.ok === true &&
      r.status === 200 &&
      UUID.test(r.id) &&
      /^[1-9]\d*$/.test(String(r.revision)),
  );
  if (sameKey) {
    check(
      good.length === 2 &&
        good[0].id === good[1].id &&
        String(good[0].revision) === String(good[1].revision),
    );
    return {
      successful_responses: 2,
      insufficient_responses: 0,
      same_result: true,
    };
  }
  check(
    good.length === 1 &&
      responses.filter(
        (r) => r?.ok === false && r.status === 422 && r.code === "PT422",
      ).length === 1,
  );
  return {
    successful_responses: 1,
    insufficient_responses: 1,
    same_result: false,
  };
}
export async function settleSalesRequests(promises) {
  const settled = await Promise.allSettled(promises);
  check(settled.every((r) => r.status === "fulfilled"));
  return settled.map((r) => r.value);
}
export function verifyOwnedSaleItems(
  sales,
  ownIds,
  variants,
  itemsById,
  marker,
) {
  check(sales.every((sale) => ownIds.has(sale.id)));
  for (const sale of sales) {
    const items = itemsById.get(sale.id);
    check(
      Array.isArray(items) &&
        items.length >= 1 &&
        items.length <= variants.length,
    );
    check(new Set(items.map((i) => i.variant_id)).size === items.length);
    check(
      items.every(
        (i) =>
          i.product_name === marker &&
          variants.some((v) => v.id === i.variant_id && v.sku === i.sku),
      ),
    );
  }
}
export function sanitizeSalesReport(report) {
  check(
    report &&
      UUID.test(report.run_id) &&
      Number.isFinite(Date.parse(report.started_at)) &&
      Number.isFinite(Date.parse(report.finished_at)),
  );
  check(
    ["passed", "failed"].includes(report.status) &&
      (report.failed_phase === null ||
        SALES_PHASES.includes(report.failed_phase)),
  );
  check(
    Array.isArray(report.checks) &&
      report.checks.length <= SALES_PHASES.length &&
      new Set(report.checks.map((c) => c.name)).size === report.checks.length,
  );
  check(
    report.checks.every(
      (c) =>
        SALES_PHASES.includes(c.name) && ["PASS", "FAIL"].includes(c.status),
    ),
  );
  check(
    typeof report.compensated === "boolean" &&
      typeof report.archived === "boolean",
  );
  if (report.status === "passed")
    check(
      report.failed_phase === null &&
        report.checks.length === SALES_PHASES.length &&
        report.checks.every((c) => c.status === "PASS") &&
        report.compensated &&
        report.archived,
    );
  const evidence = {};
  for (const name of ["last_item", "same_key", "cancel"]) {
    if (report.parallel?.[name]) {
      const r = report.parallel[name];
      check(
        [1, 2].includes(r.successful_responses) &&
          typeof r.same_result === "boolean",
      );
      evidence[name] = {
        successful_responses: r.successful_responses,
        same_result: r.same_result,
      };
    }
  }
  return {
    schema_version: 1,
    run_id: report.run_id,
    started_at: report.started_at,
    finished_at: report.finished_at,
    status: report.status,
    failed_phase: report.failed_phase,
    checks: report.checks.map(({ name, status }) => ({ name, status })),
    parallel: evidence,
    compensated: report.compensated,
    archived: report.archived,
    cleanup_retry: "not_run",
  };
}

export async function runHostedSales() {
  check(UUID.test(process.env.OPERATIONS_RUN_ID));
  const report = {
    run_id: process.env.OPERATIONS_RUN_ID,
    started_at: new Date().toISOString(),
    finished_at: null,
    status: "failed",
    failed_phase: null,
    checks: [],
    parallel: {},
    compensated: false,
    archived: false,
  };
  const marker = `FICTICIO HOMOLOG005 ${report.run_id}`;
  const fixture = {
    marker,
    productId: null,
    supplierId: null,
    variants: [],
    browserSaleId: null,
    restSaleId: null,
  };
  let admin, manager, cashier, browser, publicKey;
  let unresolvedMutation = false;
  const ownSales = new Set();
  const browserAttempts = [];
  const sessionForPage = new WeakMap();
  const journal = {
    run_id: report.run_id,
    operations: [],
    browser_attempts: [],
  };
  const journalDir = resolve("test-results/pdv-005");
  const journalPath = join(journalDir, report.run_id + ".json");
  function persistJournal() {
    mkdirSync(journalDir, { recursive: true });
    writeFileSync(journalPath + ".tmp", JSON.stringify(journal), {
      encoding: "utf8",
    });
    renameSync(journalPath + ".tmp", journalPath);
  }
  let activePhase = "configuration";
  const stage = async (name, operation) => {
    activePhase = name;
    try {
      await operation();
      report.checks.push({ name, status: "PASS" });
    } catch {
      report.checks.push({ name, status: "FAIL" });
      report.failed_phase ??= name;
      throw new Error("sales probe failed");
    }
  };
  const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    db: { retry: false },
    global: {
      fetch: (input, init = {}) =>
        fetch(input, {
          ...init,
          redirect: "error",
          signal: init.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)])
            : AbortSignal.timeout(20000),
        }),
    },
  };
  const data = (result) => {
    check(result && !result.error && result.data !== null);
    return result.data;
  };
  const rpc = async (session, name, payload = {}) => {
    const mutation = ![
      "inventory_stock",
      "sales_list",
      "sales_items",
      "sales_variants",
      "procurement_orders",
      "procurement_order_items",
      "procurement_suppliers",
    ].includes(name);
    const attempt = mutation
      ? { actor_id: session.id, name, payload, state: "pending" }
      : null;
    if (attempt) {
      journal.operations.push(attempt);
      persistJournal();
    }
    try {
      const response = await fetch(`${PROJECT}/rest/v1/rpc/${name}`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: {
          apikey: publicKey,
          Authorization: `Bearer ${session.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...SCOPE, ...payload }),
      });
      const text = await response.text();
      check(text.length <= 512 * 1024);
      const body = JSON.parse(text);
      if (!response.ok) {
        const code = ["PT409", "PT422", "42501", "22023"].includes(body?.code)
          ? body.code
          : "other";
        if (attempt) {
          attempt.state = response.status >= 500 ? "unresolved" : "rejected";
          attempt.result = { status: response.status, code };
          if (attempt.state === "unresolved") unresolvedMutation = true;
          persistJournal();
        }
        return { ok: false, status: response.status, code };
      }
      check(Array.isArray(body) && body.length <= 100);
      const result = {
        ok: true,
        status: response.status,
        rows: body,
        ...(body.length === 1 && UUID.test(body[0]?.id)
          ? { id: body[0].id, revision: String(body[0].revision) }
          : {}),
      };
      if (attempt) {
        check(UUID.test(result.id));
        attempt.state = "confirmed";
        attempt.result = { id: result.id, revision: result.revision };
        persistJournal();
      }
      if (name === "sales_confirm" && result.ok) ownSales.add(result.id);
      return result;
    } catch {
      if (attempt) {
        unresolvedMutation = true;
        attempt.state = "unresolved";
        try {
          persistJournal();
        } catch {
          /* Existing pending journal remains recovery input. */
        }
      }
      throw new Error("sales probe failed");
    }
  };
  const rows = (r) => {
    check(r.ok);
    return r.rows;
  };
  const one = (r) => {
    const values = rows(r);
    check(values.length === 1);
    return values[0];
  };
  const stock = async (id) =>
    one(
      await rpc(manager, "inventory_stock", {
        p_query: "",
        p_limit: 1,
        p_offset: 0,
        p_variant_id: id,
      }),
    );
  const saleList = async () => {
    const result = rows(
      await rpc(manager, "sales_list", {
        p_query: marker,
        p_status: "all",
        p_limit: 100,
        p_offset: 0,
        p_sale_id: null,
      }),
    );
    check(
      result.length === 0 || Number(result[0].total_count) === result.length,
    );
    return result;
  };
  const cancel = (id, revision = "1", key = randomUUID()) =>
    rpc(manager, "sales_cancel", {
      p_sale_id: id,
      p_expected_revision: revision,
      p_reason: marker,
      p_idempotency_key: key,
    });
  const line = (index, quantity = 1) => ({
    variant_id: fixture.variants[index].id,
    quantity,
    expected_unit_price_cents: index === 0 ? 1999 : 2999,
  });
  const confirm = (items, key = randomUUID(), session = manager) =>
    rpc(session, "sales_confirm", { p_items: items, p_idempotency_key: key });
  const movementCount = async (id, kind) => {
    const values = data(
      await admin
        .from("inventory_movements")
        .select("id,variant_id,quantity,kind")
        .eq("organization_id", ORG)
        .eq("store_id", STORE)
        .eq(
          "reason",
          `${kind === "exit" ? "Venda" : "Cancelamento de venda"} ${id}`,
        ),
    );
    check(
      values.length > 0 &&
        values.every(
          (m) =>
            m.kind === kind &&
            fixture.variants.some((v) => v.id === m.variant_id),
        ) &&
        new Set(values.map((m) => m.variant_id)).size === values.length,
    );
    return values.length;
  };
  const signIn = async (email, id) => {
    check(UUID.test(id));
    const existing = data(await admin.auth.admin.getUserById(id));
    check(existing.user?.id === id && existing.user.email === email);
    const link = data(
      await admin.auth.admin.generateLink({ type: "magiclink", email }),
    );
    check(
      link.user?.id === id && typeof link.properties?.hashed_token === "string",
    );
    const jar = new Map();
    const client = createServerClient(PROJECT, publicKey, {
      cookieOptions: { secure: true, sameSite: "lax", path: "/" },
      auth: { autoRefreshToken: false, detectSessionInUrl: false },
      global: options.global,
      cookies: {
        getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
        setAll: (updates) => {
          for (const cookie of updates) jar.set(cookie.name, cookie);
        },
      },
    });
    const verified = data(
      await client.auth.verifyOtp({
        token_hash: link.properties.hashed_token,
        type: "magiclink",
      }),
    );
    check(verified.user?.id === id && verified.session?.access_token);
    const cookies = [...jar.values()]
      .filter((c) => c.value)
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: new URL(WORKER).hostname,
        path: "/",
        secure: true,
        httpOnly: false,
        sameSite: "Lax",
      }));
    check(cookies.length > 0);
    return { token: verified.session.access_token, cookies, id };
  };
  const pageFor = async (session) => {
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.addCookies(session.cookies);
    await context.addCookies([
      {
        name: "c360-store",
        value: STORE,
        domain: new URL(WORKER).hostname,
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const page = await context.newPage();
    sessionForPage.set(page, session);
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(45000);
    return page;
  };
  // UI names are shared with the authored E2E contract. Never inspect bodies,
  // cookies, JWTs or arbitrary provider text into public evidence.
  const browserConfirm = async (page, index, quantity = 1) => {
    await page.goto(`${WORKER}/app/pdv`, { waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("Loja", { exact: true })).toHaveValue(STORE);
    await page.route("**/app/pdv*", async (route) => {
      try {
        if (
          route.request().method() === "POST" &&
          route.request().headers()["next-action"]
        ) {
          const saved = await page.evaluate(
            (key) => sessionStorage.getItem(key),
            `c360:pdv:v1:${sessionForPage.get(page).id}:${ORG}:${STORE}`,
          );
          if (saved === null) {
            await route.continue();
            return;
          }
          const attempt = JSON.parse(saved);
          check(
            attempt &&
              ["confirm", "cancel"].includes(attempt.kind) &&
              UUID.test(attempt.payload?.idempotencyKey),
          );
          if (attempt.kind === "confirm")
            check(
              Array.isArray(attempt.payload.items) &&
                attempt.payload.items.length >= 1 &&
                attempt.payload.items.length <= 2 &&
                attempt.payload.items.every(
                  (i) =>
                    fixture.variants.some((v) => v.id === i.variantId) &&
                    /^[1-9]\d{0,6}$/.test(i.quantity) &&
                    [1999, 2999].includes(i.expectedUnitPriceCents),
                ),
            );
          else
            check(
              ownSales.has(attempt.payload.saleId) &&
                attempt.payload.reason === marker,
            );
          const value = {
            session: sessionForPage.get(page),
            kind: attempt.kind,
            payload: attempt.payload,
          };
          if (
            !browserAttempts.some(
              (a) => a.payload.idempotencyKey === value.payload.idempotencyKey,
            )
          ) {
            browserAttempts.push(value);
            journal.browser_attempts.push({
              actor_id: value.session.id,
              kind: value.kind,
              payload: value.payload,
            });
            persistJournal();
          }
        }
        await route.continue();
      } catch {
        unresolvedMutation = true;
        await route.abort();
      }
    });
    await page
      .getByLabel("Buscar variante por produto, SKU ou código de barras")
      .fill(fixture.variants[index].sku);
    await page.getByRole("button", { name: "Buscar SKU", exact: true }).click();
    await page
      .getByRole("button", {
        name: `Adicionar ${fixture.variants[index].sku}`,
        exact: true,
      })
      .click();
    await page
      .getByLabel(`Quantidade ${fixture.variants[index].sku}`, { exact: true })
      .fill(String(quantity));
    await page
      .getByLabel("Conferi os itens, quantidades e preços desta venda")
      .check();
    await page
      .getByRole("button", {
        name: "Confirmar venda e baixar estoque",
        exact: true,
      })
      .click();
    await expect(page.getByLabel("Detalhes da venda")).toBeVisible();
    await expect(page).toHaveURL(/[?&]venda=[0-9a-f-]{36}/);
    const id = new URL(page.url()).searchParams.get("venda");
    check(UUID.test(id));
    ownSales.add(id);
    return id;
  };
  try {
    await stage("configuration", async () => {
      check(
        process.env.NEXT_PUBLIC_SUPABASE_URL === PROJECT &&
          process.env.OPERATIONS_WORKER_URL === WORKER &&
          process.env.OPERATIONS_CONFIRMED === "yes",
      );
      publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      check(
        publicKey?.startsWith("sb_publishable_") &&
          process.env.SUPABASE_SECRET_KEY?.length > 100,
      );
      admin = createClient(PROJECT, process.env.SUPABASE_SECRET_KEY, options);
      for (const name of [
        "SUPABASE_SECRET_KEY",
        "SUPABASE_ACCESS_TOKEN",
        "SUPABASE_DB_PASSWORD",
        "CLOUDFLARE_API_TOKEN",
      ])
        delete process.env[name];
    });
    await stage("existing_login", async () => {
      manager = await signIn(
        "gerente.aurora@example.test",
        process.env.OPERATIONS_MANAGER_ID,
      );
      cashier = await signIn(
        "caixa.aurora@example.test",
        process.env.OPERATIONS_CASHIER_ID,
      );
    });
    await stage("catalog_purchase_fixtures", async () => {
      const made = one(
        await rpc(manager, "catalog_create_product", {
          p_name: marker,
          p_description:
            "Dados fictícios de homologação005; preservar histórico.",
          p_category_id: null,
          p_sku: `H005-${report.run_id}-A`,
          p_color: null,
          p_size: "A",
          p_barcode: null,
          p_idempotency_key: randomUUID(),
        }),
      );
      fixture.productId = made.id;
      one(
        await rpc(manager, "catalog_create_variant", {
          p_product_id: made.id,
          p_sku: `H005-${report.run_id}-B`,
          p_color: null,
          p_size: "B",
          p_barcode: null,
        }),
      );
      fixture.variants = data(
        await admin
          .from("product_variants")
          .select("id,sku")
          .eq("organization_id", ORG)
          .eq("product_id", made.id),
      ).sort((a, b) => a.sku.localeCompare(b.sku));
      check(fixture.variants.length === 2);
      for (let i = 0; i < 2; i++) {
        check(Number((await stock(fixture.variants[i].id)).quantity) === 0);
        one(
          await rpc(manager, "catalog_set_price", {
            p_variant_id: fixture.variants[i].id,
            p_expected_revision: null,
            p_amount: i === 0 ? "19.99" : "29.99",
          }),
        );
      }
      fixture.supplierId = randomUUID();
      one(
        await rpc(manager, "procurement_save_supplier", {
          p_supplier_id: fixture.supplierId,
          p_name: marker,
          p_contact: "FICTICIO sem comunicação externa",
          p_active: true,
          p_expected_revision: "0",
          p_idempotency_key: randomUUID(),
        }),
      );
      const order = one(
        await rpc(manager, "procurement_create_order", {
          p_supplier_id: fixture.supplierId,
          p_items: fixture.variants.map((v) => ({
            variant_id: v.id,
            quantity: 5,
            unit_cost_cents: 1234,
          })),
          p_idempotency_key: randomUUID(),
        }),
      );
      one(
        await rpc(manager, "procurement_receive_order", {
          p_order_id: order.id,
          p_expected_revision: String(order.revision),
          p_idempotency_key: randomUUID(),
        }),
      );
      const browserEnv = {};
      for (const name of [
        "PATH",
        "Path",
        "SystemRoot",
        "WINDIR",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "LOCALAPPDATA",
        "APPDATA",
        "HOME",
      ])
        if (process.env[name]) browserEnv[name] = process.env[name];
      browser = await chromium.launch({ headless: true, env: browserEnv });
    });
    const page = await pageFor(manager);
    await stage("browser_sale", async () => {
      fixture.browserSaleId = await browserConfirm(page, 0, 2);
      check((await movementCount(fixture.browserSaleId, "exit")) === 1);
    });
    await stage("browser_inventory", async () => {
      await page.goto(
        `${WORKER}/app/estoque?q=${encodeURIComponent(fixture.variants[0].sku)}`,
      );
      await page
        .getByRole("link", {
          name: new RegExp(`SKU ${fixture.variants[0].sku}`),
        })
        .click();
      await expect(page.getByText("Saldo atual:")).toContainText("3 unidades");
      check(Number((await stock(fixture.variants[0].id)).quantity) === 3);
    });
    await stage("rest_snapshot_replay", async () => {
      const key = randomUUID(),
        items = [line(0), line(1)];
      const made = one(await confirm(items, key));
      fixture.restSaleId = made.id;
      const replay = one(await confirm([...items].reverse(), key));
      check(
        replay.id === made.id &&
          String(replay.revision) === String(made.revision),
      );
      const conflict = await confirm([line(0, 2), line(1)], key);
      check(
        !conflict.ok && conflict.status === 409 && conflict.code === "PT409",
      );
      const snapshots = rows(
        await rpc(manager, "sales_items", { p_sale_id: made.id }),
      );
      check(
        snapshots.length === 2 &&
          snapshots.every(
            (i) =>
              i.product_name === marker &&
              Number(i.unit_price_cents) ===
                (i.sku.endsWith("-A") ? 1999 : 2999),
          ),
      );
      check((await movementCount(made.id, "exit")) === 2);
    });
    await stage("rest_price_conflict", async () => {
      const variantId = fixture.variants[0].id;
      const price = data(
        await admin
          .from("product_prices")
          .select("revision")
          .eq("organization_id", ORG)
          .eq("store_id", STORE)
          .eq("variant_id", variantId)
          .single(),
      );
      const changed = one(
        await rpc(manager, "catalog_set_price", {
          p_variant_id: variantId,
          p_expected_revision: String(price.revision),
          p_amount: "20.99",
        }),
      );
      const before = Number((await stock(variantId)).quantity);
      const conflict = await confirm([line(0)]);
      check(
        !conflict.ok &&
          conflict.status === 409 &&
          conflict.code === "PT409" &&
          Number((await stock(variantId)).quantity) === before,
      );
      one(
        await rpc(manager, "catalog_set_price", {
          p_variant_id: variantId,
          p_expected_revision: String(changed.revision),
          p_amount: "19.99",
        }),
      );
      const items = rows(
        await rpc(manager, "sales_items", { p_sale_id: fixture.restSaleId }),
      );
      check(
        items.some(
          (i) =>
            i.variant_id === variantId && Number(i.unit_price_cents) === 1999,
        ),
      );
    });
    await stage("rest_multiline_rollback", async () => {
      const before = await Promise.all(
        fixture.variants.map(async (v) => Number((await stock(v.id)).quantity)),
      );
      const count = (await saleList()).length;
      const failed = await confirm([line(0), line(1, 1000000)]);
      check(!failed.ok && failed.status === 422 && failed.code === "PT422");
      check((await saleList()).length === count);
      for (let i = 0; i < 2; i++)
        check(
          Number((await stock(fixture.variants[i].id)).quantity) === before[i],
        );
    });
    await stage("rest_parallel_last_item", async () => {
      const balance = await stock(fixture.variants[0].id);
      check(Number(balance.quantity) >= 1);
      if (Number(balance.quantity) > 1)
        one(
          await rpc(manager, "inventory_move", {
            p_variant_id: fixture.variants[0].id,
            p_kind: "exit",
            p_quantity: Number(balance.quantity) - 1,
            p_reason: `Preparação ${marker}`,
            p_expected_revision: String(balance.revision),
            p_idempotency_key: randomUUID(),
          }),
        );
      const responses = await settleSalesRequests([
        confirm([line(0)], randomUUID(), manager),
        confirm([line(0)], randomUUID(), cashier),
      ]);
      report.parallel.last_item = assessSaleRace(responses, false);
      check(Number((await stock(fixture.variants[0].id)).quantity) === 0);
      const winner = responses.find((r) => r.ok);
      check((await movementCount(winner.id, "exit")) === 1);
    });
    await stage("rest_parallel_same_key", async () => {
      const key = randomUUID();
      const responses = await settleSalesRequests([
        confirm([line(1)], key),
        confirm([line(1)], key),
      ]);
      report.parallel.same_key = assessSaleRace(responses, true);
      check((await movementCount(responses[0].id, "exit")) === 1);
    });
    await stage("rest_isolation", async () => {
      const foreign = await rpc(manager, "sales_list", {
        p_store_id: FOREIGN_STORE,
        p_query: "",
        p_status: "all",
        p_limit: 20,
        p_offset: 0,
        p_sale_id: null,
      });
      check(!foreign.ok && foreign.status === 403 && foreign.code === "42501");
      for (const [name, args] of [
        [
          "sales_cancel",
          {
            p_sale_id: fixture.browserSaleId,
            p_expected_revision: "1",
            p_reason: marker,
            p_idempotency_key: randomUUID(),
          },
        ],
        [
          "inventory_move",
          {
            p_variant_id: fixture.variants[1].id,
            p_kind: "exit",
            p_quantity: 1,
            p_reason: marker,
            p_expected_revision: "1",
            p_idempotency_key: randomUUID(),
          },
        ],
        [
          "procurement_orders",
          {
            p_query: "",
            p_status: "all",
            p_limit: 20,
            p_offset: 0,
            p_order_id: null,
          },
        ],
      ]) {
        const denied = await rpc(cashier, name, args);
        check(!denied.ok && denied.status === 403 && denied.code === "42501");
      }
    });
    await stage("browser_cashier", async () => {
      const p = await pageFor(cashier);
      const id = await browserConfirm(p, 1);
      check((await movementCount(id, "exit")) === 1);
      await expect(
        p.getByRole("button", {
          name: "Cancelar venda e repor estoque",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(p.getByLabel("Detalhes da venda")).not.toContainText(
        "Custo unitário",
      );
      await p.context().close();
    });
    await stage("browser_cancel", async () => {
      await page.goto(`${WORKER}/app/pdv?venda=${fixture.browserSaleId}`);
      await page.getByLabel("Motivo do cancelamento").fill(marker);
      await page
        .getByLabel("Confirmo que todas as mercadorias retornaram ao estoque")
        .check();
      await page
        .getByRole("button", {
          name: "Cancelar venda e repor estoque",
          exact: true,
        })
        .click();
      await expect(page.getByLabel("Detalhes da venda")).toContainText(
        "Cancelada",
      );
      check((await movementCount(fixture.browserSaleId, "entry")) === 1);
    });
    await stage("rest_parallel_cancel", async () => {
      const keys = [randomUUID(), randomUUID()];
      const results = await settleSalesRequests(
        keys.map((key) => cancel(fixture.restSaleId, "1", key)),
      );
      check(
        results.filter((r) => r.ok && r.status === 200).length === 1 &&
          results.filter((r) => !r.ok && r.status === 409 && r.code === "PT409")
            .length === 1,
      );
      const index = results.findIndex((r) => r.ok);
      const replay = await settleSalesRequests([
        cancel(fixture.restSaleId, "1", keys[index]),
        cancel(fixture.restSaleId, "1", keys[index]),
      ]);
      report.parallel.cancel = assessSaleRace(replay, true);
      check((await movementCount(fixture.restSaleId, "entry")) === 2);
    });
  } catch {
    report.failed_phase ??= activePhase;
  } finally {
    if (manager && admin) {
      try {
        await stage("postflight_compensation", async () => {
          // Resolve every explicit browser attempt by its original UUID/payload
          // before discovery. The SQL ledger serializes an in-flight request.
          for (const attempt of browserAttempts) {
            if (attempt.kind === "confirm")
              one(
                await confirm(
                  attempt.payload.items.map((i) => ({
                    variant_id: i.variantId,
                    quantity: Number(i.quantity),
                    expected_unit_price_cents: i.expectedUnitPriceCents,
                  })),
                  attempt.payload.idempotencyKey,
                  attempt.session,
                ),
              );
            else
              one(
                await rpc(attempt.session, "sales_cancel", {
                  p_sale_id: attempt.payload.saleId,
                  p_expected_revision: attempt.payload.expectedRevision,
                  p_reason: attempt.payload.reason,
                  p_idempotency_key: attempt.payload.idempotencyKey,
                }),
              );
          }
          // An unconfirmed transport/provider failure can still commit later.
          // Keep the durable journal and refuse to claim compensation/archive.
          check(!unresolvedMutation);
          // Discover ambiguous fixture creates by exact run marker, never generic
          // product lists. No delete, seed, permission or Auth mutations.
          const products = data(
            await admin
              .from("products")
              .select("id")
              .eq("organization_id", ORG)
              .eq("name", marker),
          );
          check(products.length <= 1);
          if (products.length) {
            fixture.productId = products[0].id;
            fixture.variants = data(
              await admin
                .from("product_variants")
                .select("id,sku")
                .eq("organization_id", ORG)
                .eq("product_id", fixture.productId),
            );
            check(
              fixture.variants.length >= 1 &&
                fixture.variants.length <= 2 &&
                fixture.variants.every((v) =>
                  v.sku.startsWith(`H005-${report.run_id}-`),
                ),
            );
          }
          const suppliers = rows(
            await rpc(manager, "procurement_suppliers", {
              p_query: marker,
              p_limit: 100,
              p_offset: 0,
              p_supplier_id: null,
            }),
          );
          check(
            suppliers.length <= 1 && suppliers.every((s) => s.name === marker),
          );
          if (suppliers.length) fixture.supplierId = suppliers[0].id;
          const orders = fixture.supplierId
            ? rows(
                await rpc(manager, "procurement_orders", {
                  p_query: marker,
                  p_status: "all",
                  p_limit: 100,
                  p_offset: 0,
                  p_order_id: null,
                }),
              )
            : [];
          check(
            orders.length <= 1 &&
              orders.every((o) => o.supplier_id === fixture.supplierId),
          );
          for (const order of orders)
            if (order.status === "open")
              one(
                await rpc(manager, "procurement_cancel_order", {
                  p_order_id: order.id,
                  p_expected_revision: String(order.revision),
                  p_reason: marker,
                  p_idempotency_key: randomUUID(),
                }),
              );
          const sales = await saleList();
          const itemsById = new Map();
          for (const sale of sales) {
            itemsById.set(
              sale.id,
              rows(await rpc(manager, "sales_items", { p_sale_id: sale.id })),
            );
          }
          verifyOwnedSaleItems(
            sales,
            ownSales,
            fixture.variants,
            itemsById,
            marker,
          );
          // Ownership and the full line set of EVERY sale are checked before any
          // cancellation, so a mixed/unknown sale cannot alter unrelated stock.
          for (const sale of sales)
            if (sale.status === "confirmed")
              one(await cancel(sale.id, String(sale.revision)));
          check((await saleList()).every((s) => s.status === "cancelled"));
          const allowedReasons = new Set([
            `Preparação ${marker}`,
            `Compensação ${marker}`,
            ...orders
              .filter((o) => o.status === "received")
              .map((o) => `Recebimento de compra ${o.id}`),
            ...sales.flatMap((s) => [
              `Venda ${s.id}`,
              `Cancelamento de venda ${s.id}`,
            ]),
          ]);
          for (const variant of fixture.variants) {
            const movements = data(
              await admin
                .from("inventory_movements")
                .select("actor_user_id,kind,quantity,reason")
                .eq("organization_id", ORG)
                .eq("store_id", STORE)
                .eq("variant_id", variant.id),
            );
            check(
              movements.every(
                (m) =>
                  [manager.id, cashier.id].includes(m.actor_user_id) &&
                  allowedReasons.has(m.reason),
              ),
            );
            const expected = movements.reduce(
              (total, m) =>
                total + (m.kind === "entry" ? 1 : -1) * Number(m.quantity),
              0,
            );
            const balance = await stock(variant.id);
            check(
              expected === Number(balance.quantity) &&
                expected >= 0 &&
                expected <= 5,
            );
            if (expected > 0)
              one(
                await rpc(manager, "inventory_move", {
                  p_variant_id: variant.id,
                  p_kind: "exit",
                  p_quantity: expected,
                  p_reason: `Compensação ${marker}`,
                  p_expected_revision: String(balance.revision),
                  p_idempotency_key: randomUUID(),
                }),
              );
            check(Number((await stock(variant.id)).quantity) === 0);
          }
          report.compensated = true;
        });
      } catch {
        /* Preserve failing phase; do not guess compensation. */
      }
      try {
        await stage("postflight_archive", async () => {
          check(report.compensated);
          if (fixture.supplierId) {
            const s = one(
              await rpc(manager, "procurement_suppliers", {
                p_query: "",
                p_limit: 1,
                p_offset: 0,
                p_supplier_id: fixture.supplierId,
              }),
            );
            if (s.active)
              one(
                await rpc(manager, "procurement_save_supplier", {
                  p_supplier_id: s.id,
                  p_name: s.name,
                  p_contact: s.contact,
                  p_active: false,
                  p_expected_revision: String(s.revision),
                  p_idempotency_key: randomUUID(),
                }),
              );
          }
          if (fixture.productId) {
            const p = data(
              await admin
                .from("products")
                .select("id,name,description,category_id,revision,active")
                .eq("organization_id", ORG)
                .eq("id", fixture.productId)
                .single(),
            );
            check(p.name === marker);
            if (p.active)
              one(
                await rpc(manager, "catalog_update_product", {
                  p_product_id: p.id,
                  p_expected_revision: String(p.revision),
                  p_name: p.name,
                  p_description: p.description,
                  p_category_id: p.category_id,
                  p_active: false,
                }),
              );
            check(
              data(
                await admin
                  .from("products")
                  .select("active")
                  .eq("organization_id", ORG)
                  .eq("id", p.id)
                  .single(),
              ).active === false,
            );
          }
          report.archived = true;
        });
      } catch {
        /* Immutable business history is retained. */
      }
    }
    if (browser)
      try {
        await browser.close();
      } catch {
        report.failed_phase ??= "postflight_archive";
      }
    report.finished_at = new Date().toISOString();
    if (!report.failed_phase && report.compensated && report.archived)
      report.status = "passed";
  }
  return sanitizeSalesReport(report);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.warn = () => {};
  console.error = () => {};
  try {
    const report = await runHostedSales();
    process.stdout.write(JSON.stringify(report));
    process.exitCode = report.status === "passed" ? 0 : 1;
  } catch {
    process.stdout.write(
      JSON.stringify({
        schema_version: 1,
        status: "failed",
        failed_phase: "configuration",
        checks: [],
        compensated: false,
        archived: false,
        cleanup_retry: "not_run",
      }),
    );
    process.exitCode = 1;
  }
}
