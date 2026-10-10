// Explicit opt-in through scripts/operations-hosted.ps1. All credentials,
// cookies, fixture IDs and provider bodies remain in this parent process.
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium, expect } from "@playwright/test";

const PROJECT = "https://qiwblpmocldqbijbylwg.supabase.co";
const WORKER = "https://comercio360.alexsandrors-0312.workers.dev";
const ORG = "10000000-0000-4000-8000-000000000001";
const STORE = "10000000-0000-4000-8000-000000000011";
const FOREIGN_STORE = "20000000-0000-4000-8000-000000000011";
const SCOPE = { p_organization_id: ORG, p_store_id: STORE };
const PHASES = ["configuration", "existing_login", "catalog_fixtures", "browser_supplier", "browser_order", "browser_receive", "browser_inventory", "rest_replay", "rest_payload_conflict", "rest_parallel_cas", "rest_parallel_replay", "rest_isolation", "browser_cashier", "postflight_compensation", "postflight_archive"];
const SUPPLIER_STEPS = ["page_status", "heading", "store", "open", "fields", "submit", "rpc", "cookies"];
const PAGE_FLAGS = ["http_200", "route_compras", "route_login", "access_denied", "unavailable", "native_form_query"];
const NOTICES = ["invalid", "denied", "conflict", "duplicate", "unavailable", "ambiguous", "success", "none"];
const POST_STATUSES = ["not_observed", "200", "400", "401", "403", "404", "409", "422", "500", "502", "503", "504", "other"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const check = (condition) => { if (!condition) throw new Error("operations probe failed"); };

export function classifySupplierNotice(text, ambiguous = false) {
  if (ambiguous === true) return "ambiguous";
  const mappings = [
    ["invalid", "Confira o fornecedor, os itens, as quantidades e os custos informados."],
    ["denied", "Você não tem permissão para esta operação de compras nesta loja."],
    ["conflict", "O pedido ou fornecedor mudou, ou esta chave já foi usada com outros dados."],
    ["duplicate", "Já existe um fornecedor com este nome na empresa."],
    ["unavailable", "Não foi possível confirmar a operação."],
    ["unavailable", "Não foi possível confirmar o resultado."],
    ["success", "Fornecedor salvo."],
  ];
  return mappings.find(([, message]) => typeof text === "string" && text.includes(message))?.[0] ?? "none";
}
export function classifySupplierPostStatus(status) {
  return POST_STATUSES.includes(String(status)) ? String(status) : "other";
}

export async function runBrowserSupplierSteps(operations, record) {
  check(typeof record === "function" && operations && SUPPLIER_STEPS.every((step) => typeof operations[step] === "function"));
  for (const step of SUPPLIER_STEPS) {
    try { await operations[step](); record({ name: step, status: "PASS" }); }
    catch { record({ name: step, status: "FAIL" }); throw new Error("operations probe failed"); }
  }
}

/** Classify real concurrent REST responses without exposing payloads. */
export function assessParallelReceipts(responses, sameKey) {
  check(Array.isArray(responses) && responses.length === 2);
  const success = responses.filter((response) => response?.ok === true && response.status === 200 && UUID.test(response.id) && /^[1-9]\d*$/.test(String(response.revision)));
  if (sameKey) {
    check(success.length === 2 && success[0].id === success[1].id && String(success[0].revision) === String(success[1].revision));
    return { successful_responses: 2, conflicts: 0, same_result: true };
  }
  check(success.length === 1 && responses.filter((response) => response?.ok === false && response.status === 409 && response.code === "PT409").length === 1);
  return { successful_responses: 1, conflicts: 1, same_result: false };
}

export function sanitizeOperationsReport(report) {
  check(report && UUID.test(report.run_id) && Number.isFinite(Date.parse(report.started_at)) && Number.isFinite(Date.parse(report.finished_at)));
  check(["passed", "failed"].includes(report.status) && (report.failed_phase === null || PHASES.includes(report.failed_phase)));
  check(Array.isArray(report.checks) && report.checks.length <= PHASES.length && new Set(report.checks.map((entry) => entry.name)).size === report.checks.length);
  check(report.checks.every((entry) => PHASES.includes(entry.name) && ["PASS", "FAIL"].includes(entry.status)));
  check(typeof report.compensated === "boolean" && typeof report.archived === "boolean");
  const supplierSteps = report.browser_supplier_steps ?? [];
  check(Array.isArray(supplierSteps) && supplierSteps.length <= SUPPLIER_STEPS.length && new Set(supplierSteps.map((entry) => entry.name)).size === supplierSteps.length);
  check(supplierSteps.every((entry, index) => entry.name === SUPPLIER_STEPS[index] && ["PASS", "FAIL"].includes(entry.status)));
  const failedSubstep = report.failed_substep ?? null;
  check(failedSubstep === null || (report.failed_phase === "browser_supplier" && SUPPLIER_STEPS.includes(failedSubstep) && supplierSteps.at(-1)?.name === failedSubstep && supplierSteps.at(-1)?.status === "FAIL"));
  check(report.status !== "passed" || (supplierSteps.length === SUPPLIER_STEPS.length && supplierSteps.every((entry) => entry.status === "PASS")));
  const pageFlags = { ...Object.fromEntries(PAGE_FLAGS.map((name) => [name, false])), ...report.browser_supplier_page };
  check(PAGE_FLAGS.every((name) => typeof pageFlags[name] === "boolean"));
  const submit = report.browser_supplier_submit ?? { notice: "none", notice_present: false, post_observed: false, post_http_status: "not_observed", screenshot_saved: false };
  check(NOTICES.includes(submit.notice) && POST_STATUSES.includes(submit.post_http_status) && [submit.notice_present, submit.post_observed, submit.screenshot_saved].every((value) => typeof value === "boolean"));
  check(report.status !== "passed" || (report.failed_phase === null && report.checks.length === PHASES.length && report.checks.every((entry) => entry.status === "PASS") && report.compensated && report.archived));
  return {
    schema_version: 1, run_id: report.run_id, started_at: report.started_at, finished_at: report.finished_at,
    status: report.status, failed_phase: report.failed_phase, failed_substep: failedSubstep,
    browser_supplier_steps: supplierSteps.map(({ name, status }) => ({ name, status })),
    browser_supplier_page: Object.fromEntries(PAGE_FLAGS.map((name) => [name, pageFlags[name]])),
    browser_supplier_submit: { notice: submit.notice, notice_present: submit.notice_present, post_observed: submit.post_observed, post_http_status: submit.post_http_status, screenshot_saved: submit.screenshot_saved },
    checks: report.checks.map(({ name, status }) => ({ name, status })),
    compensated: report.compensated, archived: report.archived,
    fixture_marker: "FICTICIO HOMOLOG004", business_history: "preserved", cleanup_retry: "not_run",
  };
}

export async function runHostedOperations() {
  const report = { run_id: randomUUID(), started_at: new Date().toISOString(), finished_at: null, status: "failed", failed_phase: null, failed_substep: null, browser_supplier_steps: [], browser_supplier_page: Object.fromEntries(PAGE_FLAGS.map((name) => [name, false])), browser_supplier_submit: { notice: "none", notice_present: false, post_observed: false, post_http_status: "not_observed", screenshot_saved: false }, checks: [], compensated: false, archived: false };
  const marker = `FICTICIO HOMOLOG004 ${report.run_id}`;
  const fixture = { productId: null, supplierId: null, variants: [], supplierName: marker, productName: marker, skus: [`H004-${report.run_id}-A`, `H004-${report.run_id}-B`] };
  let admin;
  let manager;
  let cashier;
  let browser;
  let activePhase = "configuration";
  let publicKey;
  const options = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    db: { retry: false },
    global: { fetch: (input, init = {}) => fetch(input, { ...init, redirect: "error", signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) }) },
  };
  const stage = async (name, operation) => {
    activePhase = name;
    try { await operation(); report.checks.push({ name, status: "PASS" }); }
    catch { report.checks.push({ name, status: "FAIL" }); report.failed_phase ??= name; throw new Error("operations probe failed"); }
  };
  const data = (response) => { check(response && !response.error && response.data !== null); return response.data; };
  const rpc = async (session, name, payload = {}) => {
    const response = await fetch(`${PROJECT}/rest/v1/rpc/${name}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { apikey: publicKey, Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...SCOPE, ...payload }),
    });
    const text = await response.text();
    check(text.length <= 512 * 1024);
    const body = JSON.parse(text);
    if (!response.ok) return { ok: false, status: response.status, code: ["PT409", "42501", "22023"].includes(body?.code) ? body.code : "other" };
    check(Array.isArray(body) && body.length <= 100);
    return { ok: true, status: response.status, rows: body, ...((body.length === 1 && UUID.test(body[0]?.id)) ? { id: body[0].id, revision: String(body[0].revision) } : {}) };
  };
  const rows = (result) => { check(result.ok); return result.rows; };
  const one = (result) => { const values = rows(result); check(values.length === 1); return values[0]; };
  const orders = async () => {
    if (!fixture.supplierId) return [];
    const all = rows(await rpc(manager, "procurement_orders", { p_query: fixture.supplierName, p_status: "all", p_limit: 100, p_offset: 0, p_order_id: null }));
    check(all.every((order) => order.supplier_id === fixture.supplierId) && (all.length === 0 || Number(all[0].total_count) === all.length));
    return all;
  };
  const stock = async (variantId) => one(await rpc(manager, "inventory_stock", { p_query: "", p_limit: 100, p_offset: 0, p_variant_id: variantId }));
  const createOrder = async (quantities = [1, 1]) => {
    const result = await rpc(manager, "procurement_create_order", { p_supplier_id: fixture.supplierId, p_items: fixture.variants.map((variant, index) => ({ variant_id: variant.id, quantity: quantities[index], unit_cost_cents: [1234, 2500][index] })), p_idempotency_key: randomUUID() });
    return one(result);
  };
  const assertSingleReceipt = async (orderId) => {
    const movements = data(await admin.from("inventory_movements").select("id,variant_id,quantity,kind").eq("organization_id", ORG).eq("store_id", STORE).eq("reason", `Recebimento de compra ${orderId}`));
    check(movements.length === 2 && new Set(movements.map((movement) => movement.variant_id)).size === 2 && movements.every((movement) => movement.kind === "entry" && fixture.variants.some((variant) => variant.id === movement.variant_id)));
    const audit = await admin.from("audit_events").select("id", { count: "exact", head: true }).eq("organization_id", ORG).eq("entity_type", "purchase_orders").eq("entity_id", orderId).eq("action", "update").contains("new_value", { status: "received" });
    check(!audit.error && audit.count === 1);
  };
  const signInExisting = async (email, id) => {
    check(UUID.test(id));
    const existing = data(await admin.auth.admin.getUserById(id));
    check(existing.user?.id === id && existing.user.email === email);
    const generated = data(await admin.auth.admin.generateLink({ type: "magiclink", email }));
    check(generated.user?.id === id && typeof generated.properties?.hashed_token === "string");
    const jar = new Map();
    const client = createServerClient(PROJECT, publicKey, {
      cookieOptions: { secure: true, sameSite: "lax", path: "/" },
      auth: { autoRefreshToken: false, detectSessionInUrl: false },
      global: options.global,
      cookies: { getAll: () => [...jar].map(([name, cookie]) => ({ name, value: cookie.value })), setAll: (updates) => { for (const cookie of updates) jar.set(cookie.name, cookie); } },
    });
    const verified = data(await client.auth.verifyOtp({ token_hash: generated.properties.hashed_token, type: "magiclink" }));
    check(verified.user?.id === id && verified.session?.access_token);
    const cookies = [...jar.values()].filter((cookie) => cookie.value).map((cookie) => ({ name: cookie.name, value: cookie.value, domain: new URL(WORKER).hostname, path: "/", secure: true, httpOnly: false, sameSite: "Lax" }));
    check(cookies.length > 0 && cookies.every((cookie) => cookie.secure));
    return { token: verified.session.access_token, cookies };
  };
  try {
    await stage("configuration", async () => {
      check(process.env.NEXT_PUBLIC_SUPABASE_URL === PROJECT && process.env.OPERATIONS_WORKER_URL === WORKER && process.env.OPERATIONS_CONFIRMED === "yes");
      publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      check(publicKey?.startsWith("sb_publishable_") && process.env.SUPABASE_SECRET_KEY?.length > 100);
      admin = createClient(PROJECT, process.env.SUPABASE_SECRET_KEY, options);
      for (const name of ["SUPABASE_SECRET_KEY", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "CLOUDFLARE_API_TOKEN"]) delete process.env[name];
    });
    await stage("existing_login", async () => {
      manager = await signInExisting("gerente.aurora@example.test", process.env.OPERATIONS_MANAGER_ID);
      cashier = await signInExisting("caixa.aurora@example.test", process.env.OPERATIONS_CASHIER_ID);
    });
    await stage("catalog_fixtures", async () => {
      const created = one(await rpc(manager, "catalog_create_product", { p_name: fixture.productName, p_description: "Dados fictícios de homologação 004; preservar histórico.", p_category_id: null, p_sku: fixture.skus[0], p_color: null, p_size: "A", p_barcode: null, p_idempotency_key: randomUUID() }));
      fixture.productId = created.id;
      one(await rpc(manager, "catalog_create_variant", { p_product_id: fixture.productId, p_sku: fixture.skus[1], p_color: null, p_size: "B", p_barcode: null }));
      fixture.variants = data(await admin.from("product_variants").select("id,sku").eq("organization_id", ORG).eq("product_id", fixture.productId)).sort((a, b) => a.sku.localeCompare(b.sku));
      check(fixture.variants.length === 2);
      for (const variant of fixture.variants) check(Number((await stock(variant.id)).quantity) === 0);
      const browserEnv = {};
      for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "HOME"]) if (process.env[name]) browserEnv[name] = process.env[name];
      browser = await chromium.launch({ headless: true, env: browserEnv });
    });
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.addCookies(manager.cookies);
    await context.addCookies([{ name: "c360-store", value: STORE, domain: new URL(WORKER).hostname, path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(45000);
    await stage("browser_supplier", async () => {
      const form = page.getByRole("form", { name: "Cadastrar fornecedor" });
      const classifyPage = async () => {
        const url = new URL(page.url());
        report.browser_supplier_page.route_compras = url.origin === WORKER && url.pathname === "/app/compras";
        report.browser_supplier_page.route_login = url.origin === WORKER && url.pathname === "/login";
        report.browser_supplier_page.native_form_query = url.searchParams.has("name") || url.searchParams.has("contact");
        report.browser_supplier_page.access_denied = await page.getByRole("heading", { name: "Acesso não permitido", exact: true }).count() > 0;
        report.browser_supplier_page.unavailable = await page.getByRole("heading", { name: "Compras indisponíveis", exact: true }).count() > 0;
      };
      await runBrowserSupplierSteps({
        page_status: async () => {
          const response = await page.goto(`${WORKER}/app/compras`, { waitUntil: "domcontentloaded" });
          report.browser_supplier_page.http_200 = response?.status() === 200;
          await classifyPage();
          check(response?.status() === 200);
        },
        heading: async () => {
          try { await expect(page.getByRole("heading", { name: "Compras", exact: true })).toBeVisible(); }
          catch { await classifyPage(); throw new Error("operations probe failed"); }
        },
        store: async () => { await expect(page.getByLabel("Loja", { exact: true })).toHaveValue(STORE); },
        open: async () => { await page.getByText("Cadastrar novo fornecedor", { exact: true }).click(); },
        fields: async () => {
          await form.getByLabel("Nome do fornecedor").fill(fixture.supplierName);
          await form.getByLabel("Contato (opcional)").fill("FICTICIO sem comunicação externa");
        },
        submit: async () => {
          const isSupplierPost = (request) => {
            const url = new URL(request.url());
            return request.method() === "POST" && url.origin === WORKER && url.pathname === "/app/compras";
          };
          const requestSeen = (request) => { if (isSupplierPost(request)) report.browser_supplier_submit.post_observed = true; };
          const responseSeen = (response) => { if (isSupplierPost(response.request())) report.browser_supplier_submit.post_http_status = classifySupplierPostStatus(response.status()); };
          const notice = async () => {
            const text = (await form.locator('[role="alert"], [role="status"]').allTextContents()).join(" ");
            const ambiguous = await form.getByRole("button", { name: "Confirmar envio anterior", exact: true }).count() > 0;
            report.browser_supplier_submit.notice_present = text.trim().length > 0;
            report.browser_supplier_submit.notice = classifySupplierNotice(text, ambiguous);
          };
          page.on("request", requestSeen);
          page.on("response", responseSeen);
          try {
            await form.getByRole("button", { name: "Cadastrar fornecedor", exact: true }).click();
            await expect(form.getByRole("status")).toContainText("Fornecedor salvo.");
            await notice();
          } catch {
            try { await classifyPage(); } catch { /* Fixed flags only. */ }
            try { await notice(); } catch { /* No free-form diagnostics. */ }
            try {
              await mkdir("test-results", { recursive: true });
              await page.screenshot({ path: "test-results/operations-supplier-failure.png", timeout: 5000 });
              report.browser_supplier_submit.screenshot_saved = true;
            } catch { /* Screenshot absence stays explicit and never replaces failure. */ }
            throw new Error("operations probe failed");
          } finally {
            page.off("request", requestSeen);
            page.off("response", responseSeen);
          }
        },
        rpc: async () => {
          const suppliers = rows(await rpc(manager, "procurement_suppliers", { p_query: fixture.supplierName, p_limit: 100, p_offset: 0, p_supplier_id: null }));
          check(suppliers.length === 1 && suppliers[0].name === fixture.supplierName);
          fixture.supplierId = suppliers[0].id;
        },
        cookies: async () => { check((await context.cookies(WORKER)).filter((cookie) => cookie.name.includes("auth-token")).every((cookie) => cookie.secure)); },
      }, (entry) => {
        report.browser_supplier_steps.push(entry);
        if (entry.status === "FAIL") report.failed_substep = entry.name;
      });
    });
    let browserOrder;
    await stage("browser_order", async () => {
      await page.getByRole("button", { name: "Novo pedido", exact: true }).click();
      await page.getByLabel("Buscar variante por produto ou SKU").fill(`H004-${report.run_id}`);
      await page.getByRole("button", { name: "Buscar SKU", exact: true }).click();
      for (let index = 0; index < 2; index++) {
        const sku = fixture.skus[index];
        await page.getByRole("button", { name: `Adicionar ${sku}`, exact: true }).click();
        await page.getByLabel(`Quantidade ${sku}`, { exact: true }).fill(String(index + 2));
        await page.getByLabel(`Custo unitário ${sku}`, { exact: true }).fill(index ? "25,00" : "12,34");
      }
      await page.getByLabel("Fornecedor do pedido").selectOption(fixture.supplierId);
      await page.getByRole("button", { name: "Criar pedido", exact: true }).click();
      await page.waitForURL((url) => url.pathname === "/app/compras" && UUID.test(url.searchParams.get("pedido") ?? ""));
      browserOrder = new URL(page.url()).searchParams.get("pedido");
      const created = (await orders()).find((order) => order.id === browserOrder);
      check(created?.status === "open" && Number(created.total_cents) === 9968);
    });
    await stage("browser_receive", async () => {
      await page.getByLabel("Conferi todas as quantidades do pedido").check();
      await page.getByRole("button", { name: "Receber pedido completo", exact: true }).click();
      await expect(page.getByText("Recebido em", { exact: false })).toBeVisible();
      await assertSingleReceipt(browserOrder);
    });
    await stage("browser_inventory", async () => {
      for (let index = 0; index < 2; index++) {
        const variant = fixture.variants[index];
        check(Number((await stock(variant.id)).quantity) === index + 2);
        await page.goto(`${WORKER}/app/estoque?variante=${variant.id}&q=${encodeURIComponent(variant.sku)}`);
        await expect(page.getByText("Saldo atual:")).toContainText(`${index + 2} unidades`);
        await expect(page.getByText(`Recebimento de compra ${browserOrder}`, { exact: true })).toBeVisible();
      }
    });
    let replayOrder;
    let replayPayload;
    await stage("rest_replay", async () => {
      replayOrder = await createOrder();
      replayPayload = { p_order_id: replayOrder.id, p_expected_revision: String(replayOrder.revision), p_idempotency_key: randomUUID() };
      const first = await rpc(manager, "procurement_receive_order", replayPayload);
      const repeated = await rpc(manager, "procurement_receive_order", replayPayload);
      assessParallelReceipts([first, repeated], true);
      await assertSingleReceipt(replayOrder.id);
    });
    await stage("rest_payload_conflict", async () => {
      const altered = await rpc(manager, "procurement_receive_order", { ...replayPayload, p_expected_revision: "999" });
      check(!altered.ok && altered.status === 409 && altered.code === "PT409");
      const supplier = one(await rpc(manager, "procurement_suppliers", { p_query: "", p_limit: 100, p_offset: 0, p_supplier_id: fixture.supplierId }));
      const stale = await rpc(manager, "procurement_save_supplier", { p_supplier_id: fixture.supplierId, p_name: supplier.name, p_contact: supplier.contact, p_active: true, p_expected_revision: "0", p_idempotency_key: randomUUID() });
      check(!stale.ok && stale.status === 409 && stale.code === "PT409");
    });
    await stage("rest_parallel_cas", async () => {
      const order = await createOrder();
      const shared = { p_order_id: order.id, p_expected_revision: String(order.revision) };
      const results = await Promise.all([rpc(manager, "procurement_receive_order", { ...shared, p_idempotency_key: randomUUID() }), rpc(manager, "procurement_receive_order", { ...shared, p_idempotency_key: randomUUID() })]);
      assessParallelReceipts(results, false);
      await assertSingleReceipt(order.id);
    });
    await stage("rest_parallel_replay", async () => {
      const order = await createOrder();
      const payload = { p_order_id: order.id, p_expected_revision: String(order.revision), p_idempotency_key: randomUUID() };
      assessParallelReceipts(await Promise.all([rpc(manager, "procurement_receive_order", payload), rpc(manager, "procurement_receive_order", payload)]), true);
      await assertSingleReceipt(order.id);
    });
    await stage("rest_isolation", async () => {
      const storeDenied = await rpc(manager, "procurement_orders", { p_store_id: FOREIGN_STORE, p_query: "", p_status: "all", p_limit: 100, p_offset: 0, p_order_id: null });
      const roleDenied = await rpc(cashier, "procurement_orders", { p_query: "", p_status: "all", p_limit: 100, p_offset: 0, p_order_id: null });
      const writeDenied = await rpc(cashier, "procurement_receive_order", { p_order_id: browserOrder, p_expected_revision: "1", p_idempotency_key: randomUUID() });
      check([storeDenied, roleDenied, writeDenied].every((result) => !result.ok && result.code === "42501" && result.status === 403));
    });
    await stage("browser_cashier", async () => {
      const cashierContext = await browser.newContext({ serviceWorkers: "block" });
      await cashierContext.addCookies(cashier.cookies);
      const cashierPage = await cashierContext.newPage();
      await cashierPage.goto(`${WORKER}/app/compras`);
      await expect(cashierPage.getByRole("heading", { name: "Acesso não permitido" })).toBeVisible();
      await expect(cashierPage.getByRole("button", { name: "Novo pedido", exact: true })).toHaveCount(0);
      await cashierContext.close();
    });
  } catch { report.failed_phase ??= activePhase; }
  finally {
    if (admin && manager) {
      try {
        await stage("postflight_compensation", async () => {
          // Discover ambiguous committed fixture writes by exact unique names.
          const products = data(await admin.from("products").select("id").eq("organization_id", ORG).eq("name", fixture.productName));
          check(products.length <= 1);
          if (products.length) {
            fixture.productId = products[0].id;
            fixture.variants = data(await admin.from("product_variants").select("id,sku").eq("organization_id", ORG).eq("product_id", fixture.productId));
          }
          const suppliers = rows(await rpc(manager, "procurement_suppliers", { p_query: fixture.supplierName, p_limit: 100, p_offset: 0, p_supplier_id: null }));
          check(suppliers.length <= 1 && suppliers.every((supplier) => supplier.name === fixture.supplierName));
          if (suppliers.length) fixture.supplierId = suppliers[0].id;
          const expected = new Map(fixture.variants.map((variant) => [variant.id, 0]));
          for (const order of await orders()) {
            if (order.status === "open") one(await rpc(manager, "procurement_cancel_order", { p_order_id: order.id, p_expected_revision: String(order.revision), p_reason: `Encerramento FICTICIO HOMOLOG004 ${report.run_id}`, p_idempotency_key: randomUUID() }));
            if (order.status === "received") for (const item of rows(await rpc(manager, "procurement_order_items", { p_order_id: order.id }))) {
              check(expected.has(item.variant_id));
              expected.set(item.variant_id, expected.get(item.variant_id) + Number(item.quantity));
            }
          }
          for (const [variantId, quantity] of expected) {
            const balance = await stock(variantId);
            check(Number(balance.quantity) === quantity);
            if (quantity > 0) one(await rpc(manager, "inventory_move", { p_variant_id: variantId, p_kind: "exit", p_quantity: quantity, p_reason: `Compensação FICTICIO HOMOLOG004 ${report.run_id}`, p_expected_revision: String(balance.revision), p_idempotency_key: randomUUID() }));
            check(Number((await stock(variantId)).quantity) === 0);
          }
          report.compensated = true;
        });
      } catch { /* Preserve failed phase and immutable evidence. */ }
      try {
        await stage("postflight_archive", async () => {
          check(report.compensated);
          if (fixture.supplierId) {
            const supplier = one(await rpc(manager, "procurement_suppliers", { p_query: "", p_limit: 100, p_offset: 0, p_supplier_id: fixture.supplierId }));
            one(await rpc(manager, "procurement_save_supplier", { p_supplier_id: supplier.id, p_name: supplier.name, p_contact: supplier.contact, p_active: false, p_expected_revision: String(supplier.revision), p_idempotency_key: randomUUID() }));
            check(one(await rpc(manager, "procurement_suppliers", { p_query: "", p_limit: 100, p_offset: 0, p_supplier_id: supplier.id })).active === false);
          }
          if (fixture.productId) {
            const product = data(await admin.from("products").select("id,name,description,category_id,revision").eq("organization_id", ORG).eq("id", fixture.productId).single());
            one(await rpc(manager, "catalog_update_product", { p_product_id: product.id, p_expected_revision: String(product.revision), p_name: product.name, p_description: product.description, p_category_id: product.category_id, p_active: false }));
            check(data(await admin.from("products").select("active").eq("organization_id", ORG).eq("id", fixture.productId).single()).active === false);
          }
          check((await orders()).every((order) => ["received", "cancelled"].includes(order.status)));
          report.archived = true;
        });
      } catch { /* No destructive deletion or rollback of business history. */ }
    }
    if (browser) { try { await browser.close(); } catch { report.failed_phase ??= "postflight_archive"; } }
    report.finished_at = new Date().toISOString();
    if (!report.failed_phase && report.compensated && report.archived) report.status = "passed";
  }
  return sanitizeOperationsReport(report);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.warn = () => {};
  console.error = () => {};
  try {
    const report = await runHostedOperations();
    process.stdout.write(JSON.stringify(report));
    process.exitCode = report.status === "passed" ? 0 : 1;
  } catch {
    process.stdout.write(JSON.stringify({ schema_version: 1, status: "failed", failed_phase: "configuration", checks: [], compensated: false, archived: false, cleanup_retry: "not_run" }));
    process.exitCode = 1;
  }
}
