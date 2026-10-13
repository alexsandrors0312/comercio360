// Opt-in only through scripts/orders-hosted.ps1. Credentials, JWTs, cookies and
// provider bodies remain in memory; stdout contains only sanitized evidence.
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
export const ORDERS_PHASES = [
  "configuration",
  "existing_login",
  "catalog_purchase_fixture",
  "customer_fixture",
  "counter_create_replay",
  "whatsapp_create_replay",
  "whatsapp_customer_required",
  "scope_and_permissions",
  "browser_read",
  "price_conflict_atomic",
  "counter_fulfill_snapshot",
  "whatsapp_parallel_same_key",
  "parallel_distinct_key",
  "insufficient_stock_atomic",
  "parallel_cancel_replay",
  "sale_cancel_order_stays_fulfilled",
  "postflight_compensation",
  "postflight_archive",
];

const check = (condition) => {
  if (!condition) throw new Error("orders probe failed");
};
const rows = (result) => {
  check(result?.ok === true && Array.isArray(result.rows));
  return result.rows;
};
const one = (result) => {
  const values = rows(result);
  check(values.length === 1);
  return values[0];
};
const race = async (promises, sameKey = false) => {
  const settled = await Promise.allSettled(promises);
  check(settled.every((result) => result.status === "fulfilled"));
  const values = settled.map((result) => result.value);
  const good = values.filter(
    (value) => value.ok && value.status === 200 && UUID.test(value.id),
  );
  if (sameKey) {
    check(
      good.length === 2 &&
        good[0].id === good[1].id &&
        good[0].revision === good[1].revision &&
        good[0].saleId === good[1].saleId,
    );
  } else {
    check(
      good.length === 1 &&
        values.filter(
          (value) =>
            !value.ok && value.status === 409 && value.code === "PT409",
        ).length === 1,
    );
  }
  return {
    values,
    winner: good[0],
    evidence: {
      successful_responses: good.length,
      same_result: sameKey,
    },
  };
};

export function sanitizeOrdersReport(report) {
  check(
    report &&
      UUID.test(report.run_id) &&
      Number.isFinite(Date.parse(report.started_at)) &&
      Number.isFinite(Date.parse(report.finished_at)),
  );
  check(
    ["passed", "failed"].includes(report.status) &&
      (report.failed_phase === null ||
        ORDERS_PHASES.includes(report.failed_phase)),
  );
  check(
    Array.isArray(report.checks) &&
      report.checks.length <= ORDERS_PHASES.length &&
      new Set(report.checks.map((value) => value.name)).size ===
        report.checks.length &&
      report.checks.every(
        (value) =>
          ORDERS_PHASES.includes(value.name) &&
          ["PASS", "FAIL"].includes(value.status),
      ),
  );
  check(
    typeof report.compensated === "boolean" &&
      typeof report.archived === "boolean" &&
      typeof report.unresolved_mutation === "boolean",
  );
  if (report.status === "passed")
    check(
      report.failed_phase === null &&
        report.checks.length === ORDERS_PHASES.length &&
        report.checks.every((value) => value.status === "PASS") &&
        report.compensated &&
        report.archived &&
        !report.unresolved_mutation,
    );
  const parallel = {};
  for (const name of [
    "fulfill_same_key",
    "fulfill_distinct_key",
    "cancel_distinct_key",
  ]) {
    if (report.parallel?.[name]) {
      const evidence = report.parallel[name];
      check(
        [1, 2].includes(evidence.successful_responses) &&
          typeof evidence.same_result === "boolean",
      );
      parallel[name] = {
        successful_responses: evidence.successful_responses,
        same_result: evidence.same_result,
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
    parallel,
    compensated: report.compensated,
    archived: report.archived,
    unresolved_mutation: report.unresolved_mutation,
    cleanup_retry: "not_run",
  };
}

export async function runHostedOrders() {
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
  const marker = `FICTICIO HOMOLOG007 ${report.run_id}`;
  const fixture = {
    productId: null,
    variantId: null,
    supplierId: null,
    customerId: null,
    noPhoneCustomerId: null,
    orders: new Set(),
    sales: new Set(),
  };
  let admin, manager, cashier, publicKey, browser;
  let unresolvedMutation = false;
  let activePhase = "configuration";
  const journal = { run_id: report.run_id, operations: [] };
  const journalDir = resolve("test-results/pedidos-007");
  const journalPath = join(journalDir, report.run_id + ".json");
  const persistJournal = () => {
    mkdirSync(journalDir, { recursive: true });
    writeFileSync(journalPath + ".tmp", JSON.stringify(journal), "utf8");
    renameSync(journalPath + ".tmp", journalPath);
  };
  const stage = async (name, operation) => {
    activePhase = name;
    try {
      await operation();
      report.checks.push({ name, status: "PASS" });
    } catch {
      report.checks.push({ name, status: "FAIL" });
      report.failed_phase ??= name;
      throw new Error("orders probe failed");
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
  const mutations = new Set([
    "catalog_create_product",
    "catalog_create_variant",
    "catalog_set_price",
    "catalog_update_product",
    "procurement_save_supplier",
    "procurement_create_order",
    "procurement_receive_order",
    "procurement_cancel_order",
    "inventory_move",
    "customers_save",
    "orders_create",
    "orders_cancel",
    "orders_fulfill",
    "sales_cancel",
  ]);
  const rpc = async (session, name, payload = {}) => {
    const attempt = mutations.has(name)
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
          ? {
              id: body[0].id,
              revision: String(body[0].revision),
              saleId: body[0].sale_id ?? null,
            }
          : {}),
      };
      if (attempt) {
        attempt.state = "confirmed";
        attempt.result = {
          id: result.id ?? null,
          revision: result.revision ?? null,
        };
        persistJournal();
      }
      return result;
    } catch {
      if (attempt) {
        unresolvedMutation = true;
        attempt.state = "unresolved";
        try {
          persistJournal();
        } catch {
          /* Retain previous pending journal. */
        }
      }
      throw new Error("orders probe failed");
    }
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
        getAll: () =>
          [...jar].map(([name, cookie]) => ({ name, value: cookie.value })),
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
      .filter((cookie) => cookie.value)
      .map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: new URL(WORKER).hostname,
        path: "/",
        secure: true,
        httpOnly: false,
        sameSite: "Lax",
      }));
    check(cookies.length > 0);
    return { token: verified.session.access_token, cookies, id };
  };
  const stock = async () =>
    one(
      await rpc(manager, "inventory_stock", {
        p_query: "",
        p_limit: 1,
        p_offset: 0,
        p_variant_id: fixture.variantId,
      }),
    );
  const listOrder = async (id, session = manager, scope = {}) =>
    rows(
      await rpc(session, "orders_list", {
        p_status: "all",
        p_limit: 100,
        p_offset: 0,
        p_order_id: id,
        ...scope,
      }),
    );
  const orderItems = async (id) =>
    rows(await rpc(manager, "orders_items", { p_order_id: id }));
  const line = (quantity = 1) => [
    {
      variant_id: fixture.variantId,
      quantity,
      expected_unit_price_cents: 1999,
    },
  ];
  const createOrder = (
    channel,
    customerId,
    quantity = 1,
    key = randomUUID(),
    session = manager,
  ) =>
    rpc(session, "orders_create", {
      p_channel: channel,
      p_customer_id: customerId,
      p_items: line(quantity),
      p_idempotency_key: key,
    });
  const fulfillOrder = (
    id,
    revision = "1",
    key = randomUUID(),
    session = manager,
  ) =>
    rpc(session, "orders_fulfill", {
      p_order_id: id,
      p_expected_revision: revision,
      p_idempotency_key: key,
    });
  const cancelOrder = (
    id,
    revision = "1",
    key = randomUUID(),
    session = manager,
  ) =>
    rpc(session, "orders_cancel", {
      p_order_id: id,
      p_expected_revision: revision,
      p_reason: marker,
      p_idempotency_key: key,
    });
  const cancelSale = (id, revision = "1", key = randomUUID()) =>
    rpc(manager, "sales_cancel", {
      p_sale_id: id,
      p_expected_revision: revision,
      p_reason: marker,
      p_idempotency_key: key,
    });
  const customerSave = (args) =>
    rpc(manager, "customers_save", {
      p_customer_id: args.id ?? null,
      p_expected_revision: args.revision ?? null,
      p_name: args.name,
      p_phone: args.phone ?? null,
      p_email: args.email ?? null,
      p_active: args.active ?? true,
      p_idempotency_key: args.key ?? randomUUID(),
    });
  const movementCount = async (saleId, kind) => {
    const movements = data(
      await admin
        .from("inventory_movements")
        .select("id,variant_id,kind,quantity")
        .eq("organization_id", ORG)
        .eq("store_id", STORE)
        .eq(
          "reason",
          `${kind === "exit" ? "Venda" : "Cancelamento de venda"} ${saleId}`,
        ),
    );
    check(
      movements.length === 1 &&
        movements[0].variant_id === fixture.variantId &&
        movements[0].kind === kind,
    );
    return movements.length;
  };
  const orderDetail = async (id) => {
    const listed = await listOrder(id);
    check(listed.length === 1 && listed[0].id === id);
    return listed[0];
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
    await stage("catalog_purchase_fixture", async () => {
      const created = one(
        await rpc(manager, "catalog_create_product", {
          p_name: marker,
          p_description:
            "Dados fictícios de homologação007; preservar histórico.",
          p_category_id: null,
          p_sku: `H007-${report.run_id}-A`,
          p_color: null,
          p_size: "A",
          p_barcode: null,
          p_idempotency_key: randomUUID(),
        }),
      );
      fixture.productId = created.id;
      const variants = data(
        await admin
          .from("product_variants")
          .select("id,sku")
          .eq("organization_id", ORG)
          .eq("product_id", fixture.productId),
      );
      check(
        variants.length === 1 && variants[0].sku === `H007-${report.run_id}-A`,
      );
      fixture.variantId = variants[0].id;
      check(Number((await stock()).quantity) === 0);
      one(
        await rpc(manager, "catalog_set_price", {
          p_variant_id: fixture.variantId,
          p_expected_revision: null,
          p_amount: "19.99",
        }),
      );
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
      const purchase = one(
        await rpc(manager, "procurement_create_order", {
          p_supplier_id: fixture.supplierId,
          p_items: [
            {
              variant_id: fixture.variantId,
              quantity: 5,
              unit_cost_cents: 1234,
            },
          ],
          p_idempotency_key: randomUUID(),
        }),
      );
      one(
        await rpc(manager, "procurement_receive_order", {
          p_order_id: purchase.id,
          p_expected_revision: String(purchase.revision),
          p_idempotency_key: randomUUID(),
        }),
      );
      check(Number((await stock()).quantity) === 5);
    });
    await stage("customer_fixture", async () => {
      const customer = one(
        await customerSave({
          name: marker,
          phone: "(00) 00000-0000",
          email: `pedido-${report.run_id}@example.test`,
        }),
      );
      fixture.customerId = customer.id;
      check(String(customer.revision) === "1");
      const saved = data(
        await admin
          .from("customers")
          .select("name,phone,active")
          .eq("organization_id", ORG)
          .eq("id", customer.id)
          .single(),
      );
      check(
        saved.name === marker && saved.phone === "00000000000" && saved.active,
      );
      const noPhone = one(
        await customerSave({ name: `${marker} SEM TELEFONE` }),
      );
      fixture.noPhoneCustomerId = noPhone.id;
    });
    let counterId, whatsappId, raceId, stockFailId;
    await stage("counter_create_replay", async () => {
      const key = randomUUID();
      const made = one(await createOrder("counter", null, 2, key));
      counterId = made.id;
      fixture.orders.add(made.id);
      check(String(made.revision) === "1" && made.sale_id === null);
      const replay = one(await createOrder("counter", null, 2, key));
      check(replay.id === made.id && String(replay.revision) === "1");
      const changed = await createOrder("counter", null, 1, key);
      check(!changed.ok && changed.status === 409 && changed.code === "PT409");
      const order = await orderDetail(made.id);
      check(
        order.channel === "counter" &&
          order.status === "open" &&
          order.customer_id === null &&
          order.customer_name_snapshot === null &&
          Number(order.item_count) === 1 &&
          Number(order.total_cents) === 3998 &&
          order.sale_id === null,
      );
      const items = await orderItems(made.id);
      check(
        items.length === 1 &&
          items[0].variant_id === fixture.variantId &&
          items[0].product_name === marker &&
          Number(items[0].unit_price_cents) === 1999 &&
          Number(items[0].quantity) === 2,
      );
      check(Number((await stock()).quantity) === 5);
    });
    await stage("whatsapp_create_replay", async () => {
      const key = randomUUID();
      const made = one(
        await createOrder("whatsapp", fixture.customerId, 1, key, cashier),
      );
      whatsappId = made.id;
      fixture.orders.add(made.id);
      const replay = one(
        await createOrder("whatsapp", fixture.customerId, 1, key, cashier),
      );
      check(replay.id === made.id && String(replay.revision) === "1");
      const order = await orderDetail(made.id);
      check(
        order.channel === "whatsapp" &&
          order.status === "open" &&
          order.customer_id === fixture.customerId &&
          order.customer_name_snapshot === marker &&
          Number(order.total_cents) === 1999 &&
          order.sale_id === null,
      );
      check(Number((await stock()).quantity) === 5);
    });
    await stage("whatsapp_customer_required", async () => {
      const absent = await createOrder("whatsapp", null, 1);
      const noPhone = await createOrder(
        "whatsapp",
        fixture.noPhoneCustomerId,
        1,
      );
      check(
        !absent.ok &&
          absent.status === 400 &&
          absent.code === "22023" &&
          !noPhone.ok &&
          noPhone.status === 400 &&
          noPhone.code === "22023",
      );
      check(Number((await stock()).quantity) === 5);
    });
    await stage("scope_and_permissions", async () => {
      const cashierList = await listOrder(whatsappId, cashier);
      check(cashierList.length === 1 && cashierList[0].id === whatsappId);
      const deniedCancel = await cancelOrder(
        counterId,
        "1",
        randomUUID(),
        cashier,
      );
      check(
        !deniedCancel.ok &&
          deniedCancel.status === 403 &&
          deniedCancel.code === "42501",
      );
      const foreignStore = await rpc(manager, "orders_list", {
        p_store_id: FOREIGN_STORE,
        p_status: "all",
        p_limit: 20,
        p_offset: 0,
        p_order_id: counterId,
      });
      const foreignOrg = await rpc(manager, "orders_list", {
        p_organization_id: "20000000-0000-4000-8000-000000000001",
        p_status: "all",
        p_limit: 20,
        p_offset: 0,
        p_order_id: counterId,
      });
      check(
        !foreignStore.ok &&
          foreignStore.status === 403 &&
          foreignStore.code === "42501" &&
          !foreignOrg.ok &&
          foreignOrg.status === 403 &&
          foreignOrg.code === "42501",
      );
    });
    await stage("browser_read", async () => {
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
      const context = await browser.newContext({ serviceWorkers: "block" });
      await context.addCookies(manager.cookies);
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
      page.setDefaultTimeout(30000);
      page.setDefaultNavigationTimeout(45000);
      const response = await page.goto(
        `${WORKER}/app/pedidos?pedido=${whatsappId}`,
        {
          waitUntil: "domcontentloaded",
        },
      );
      check(response?.status() === 200 && !page.url().includes("/login"));
      await expect(page.locator("main")).toContainText("Pedidos");
      await context.close();
    });
    await stage("price_conflict_atomic", async () => {
      const before = Number((await stock()).quantity);
      const price = data(
        await admin
          .from("product_prices")
          .select("revision")
          .eq("organization_id", ORG)
          .eq("store_id", STORE)
          .eq("variant_id", fixture.variantId)
          .single(),
      );
      const changed = one(
        await rpc(manager, "catalog_set_price", {
          p_variant_id: fixture.variantId,
          p_expected_revision: String(price.revision),
          p_amount: "20.99",
        }),
      );
      const blocked = await fulfillOrder(counterId);
      check(
        !blocked.ok &&
          blocked.status === 409 &&
          blocked.code === "PT409" &&
          Number((await stock()).quantity) === before,
      );
      const order = await orderDetail(counterId);
      check(
        order.status === "open" &&
          order.sale_id === null &&
          String(order.revision) === "1",
      );
      one(
        await rpc(manager, "catalog_set_price", {
          p_variant_id: fixture.variantId,
          p_expected_revision: String(changed.revision),
          p_amount: "19.99",
        }),
      );
    });
    await stage("counter_fulfill_snapshot", async () => {
      const key = randomUUID();
      const fulfilled = one(await fulfillOrder(counterId, "1", key));
      check(
        fulfilled.id === counterId &&
          String(fulfilled.revision) === "2" &&
          UUID.test(fulfilled.sale_id),
      );
      fixture.sales.add(fulfilled.sale_id);
      const replay = one(await fulfillOrder(counterId, "1", key));
      check(replay.id === counterId && replay.sale_id === fulfilled.sale_id);
      const differentKey = await fulfillOrder(counterId, "1", randomUUID());
      check(
        !differentKey.ok &&
          differentKey.status === 409 &&
          differentKey.code === "PT409",
      );
      const order = await orderDetail(counterId);
      check(
        order.status === "fulfilled" &&
          order.sale_id === fulfilled.sale_id &&
          String(order.revision) === "2" &&
          Number((await stock()).quantity) === 3,
      );
      const sale = one(
        await rpc(manager, "sales_list", {
          p_query: "",
          p_status: "all",
          p_limit: 1,
          p_offset: 0,
          p_sale_id: fulfilled.sale_id,
        }),
      );
      check(sale.status === "confirmed" && Number(sale.total_cents) === 3998);
      const items = rows(
        await rpc(manager, "sales_items", { p_sale_id: sale.id }),
      );
      check(
        items.length === 1 &&
          items[0].variant_id === fixture.variantId &&
          items[0].product_name === marker &&
          Number(items[0].quantity) === 2,
      );
      check((await movementCount(sale.id, "exit")) === 1);
    });
    await stage("whatsapp_parallel_same_key", async () => {
      const key = randomUUID();
      const result = await race(
        [
          fulfillOrder(whatsappId, "1", key, manager),
          fulfillOrder(whatsappId, "1", key, manager),
        ],
        true,
      );
      report.parallel.fulfill_same_key = result.evidence;
      check(result.winner.id === whatsappId && UUID.test(result.winner.saleId));
      fixture.sales.add(result.winner.saleId);
      const order = await orderDetail(whatsappId);
      check(
        order.status === "fulfilled" &&
          order.sale_id === result.winner.saleId &&
          order.customer_name_snapshot === marker &&
          Number((await stock()).quantity) === 2,
      );
      const saleCustomer = one(
        await rpc(manager, "sales_customer", {
          p_sale_id: result.winner.saleId,
        }),
      );
      check(
        saleCustomer.customer_id === fixture.customerId &&
          saleCustomer.customer_name_snapshot === marker,
      );
      check((await movementCount(result.winner.saleId, "exit")) === 1);
    });
    await stage("parallel_distinct_key", async () => {
      const created = one(await createOrder("counter", null, 1));
      raceId = created.id;
      fixture.orders.add(created.id);
      const keys = [randomUUID(), randomUUID()];
      const result = await race([
        fulfillOrder(raceId, "1", keys[0], manager),
        fulfillOrder(raceId, "1", keys[1], cashier),
      ]);
      report.parallel.fulfill_distinct_key = result.evidence;
      check(result.winner.id === raceId && UUID.test(result.winner.saleId));
      fixture.sales.add(result.winner.saleId);
      const winnerIndex = result.values.findIndex((value) => value.ok);
      const replay = one(
        await fulfillOrder(
          raceId,
          "1",
          keys[winnerIndex],
          winnerIndex === 0 ? manager : cashier,
        ),
      );
      check(
        replay.sale_id === result.winner.saleId &&
          (await orderDetail(raceId)).sale_id === result.winner.saleId &&
          Number((await stock()).quantity) === 1,
      );
      check((await movementCount(result.winner.saleId, "exit")) === 1);
    });
    await stage("insufficient_stock_atomic", async () => {
      const created = one(await createOrder("counter", null, 2));
      stockFailId = created.id;
      fixture.orders.add(created.id);
      const before = Number((await stock()).quantity);
      check(before === 1);
      const blocked = await fulfillOrder(stockFailId);
      check(
        !blocked.ok &&
          blocked.status === 422 &&
          blocked.code === "PT422" &&
          Number((await stock()).quantity) === before,
      );
      const order = await orderDetail(stockFailId);
      check(
        order.status === "open" &&
          order.sale_id === null &&
          String(order.revision) === "1",
      );
    });
    await stage("parallel_cancel_replay", async () => {
      const keys = [randomUUID(), randomUUID()];
      const result = await race([
        cancelOrder(stockFailId, "1", keys[0]),
        cancelOrder(stockFailId, "1", keys[1]),
      ]);
      report.parallel.cancel_distinct_key = result.evidence;
      const winnerIndex = result.values.findIndex((value) => value.ok);
      const replay = one(
        await cancelOrder(stockFailId, "1", keys[winnerIndex]),
      );
      check(
        replay.id === stockFailId &&
          String(replay.revision) === "2" &&
          (await orderDetail(stockFailId)).status === "cancelled" &&
          Number((await stock()).quantity) === 1,
      );
    });
    await stage("sale_cancel_order_stays_fulfilled", async () => {
      const order = await orderDetail(counterId);
      const saleId = order.sale_id;
      check(UUID.test(saleId));
      const cancelled = one(await cancelSale(saleId));
      check(cancelled.id === saleId && String(cancelled.revision) === "2");
      check((await movementCount(saleId, "entry")) === 1);
      const after = await orderDetail(counterId);
      check(
        after.status === "fulfilled" &&
          after.sale_id === saleId &&
          String(after.revision) === "2" &&
          Number((await stock()).quantity) === 3,
      );
    });
  } catch {
    report.failed_phase ??= activePhase;
  } finally {
    if (manager && admin) {
      try {
        await stage("postflight_compensation", async () => {
          // Any ambiguous transport response may have committed later. The
          // durable journal is recovery input; never guess or claim cleanup.
          check(!unresolvedMutation);
          const products = data(
            await admin
              .from("products")
              .select("id,name,created_at")
              .eq("organization_id", ORG)
              .eq("name", marker),
          );
          check(products.length <= 1);
          if (products.length) {
            const product = products[0];
            check(
              product.name === marker &&
                Date.parse(product.created_at) >=
                  Date.parse(report.started_at) - 60000,
            );
            fixture.productId = product.id;
            const variants = data(
              await admin
                .from("product_variants")
                .select("id,sku")
                .eq("organization_id", ORG)
                .eq("product_id", product.id),
            );
            check(
              variants.length === 1 &&
                variants[0].sku === `H007-${report.run_id}-A`,
            );
            fixture.variantId = variants[0].id;
          }
          if (fixture.variantId) {
            const linked = data(
              await admin
                .from("order_items")
                .select("order_id,variant_id,product_name,sku")
                .eq("organization_id", ORG)
                .eq("store_id", STORE)
                .eq("variant_id", fixture.variantId),
            );
            check(
              linked.length <= 8 &&
                linked.every(
                  (item) =>
                    item.variant_id === fixture.variantId &&
                    item.product_name === marker &&
                    item.sku === `H007-${report.run_id}-A`,
                ),
            );
            const ids = [...new Set(linked.map((item) => item.order_id))];
            const orders = ids.length
              ? data(
                  await admin
                    .from("orders")
                    .select(
                      "id,status,revision,sale_id,actor_user_id,created_at,item_count",
                    )
                    .eq("organization_id", ORG)
                    .eq("store_id", STORE)
                    .in("id", ids),
                )
              : [];
            check(
              orders.length === ids.length &&
                orders.every(
                  (order) =>
                    ids.includes(order.id) &&
                    [manager.id, cashier.id].includes(order.actor_user_id) &&
                    Date.parse(order.created_at) >=
                      Date.parse(report.started_at) - 60000 &&
                    Number(order.item_count) === 1,
                ),
            );
            for (const order of orders) {
              const items = await orderItems(order.id);
              check(
                items.length === 1 &&
                  items[0].variant_id === fixture.variantId &&
                  items[0].product_name === marker &&
                  items[0].sku === `H007-${report.run_id}-A`,
              );
              if (order.sale_id) {
                const saleItems = rows(
                  await rpc(manager, "sales_items", {
                    p_sale_id: order.sale_id,
                  }),
                );
                check(
                  saleItems.length === 1 &&
                    saleItems[0].variant_id === fixture.variantId &&
                    saleItems[0].product_name === marker &&
                    saleItems[0].sku === `H007-${report.run_id}-A`,
                );
              }
            }
            check([...fixture.orders].every((id) => ids.includes(id)));
            check(
              [...fixture.sales].every((id) =>
                orders.some((order) => order.sale_id === id),
              ),
            );
            // Verify the complete owned set before touching any sale or order.
            for (const order of orders) {
              if (order.sale_id) {
                const sale = one(
                  await rpc(manager, "sales_list", {
                    p_query: "",
                    p_status: "all",
                    p_limit: 1,
                    p_offset: 0,
                    p_sale_id: order.sale_id,
                  }),
                );
                if (sale.status === "confirmed")
                  one(await cancelSale(sale.id, String(sale.revision)));
              }
              if (order.status === "open")
                one(await cancelOrder(order.id, String(order.revision)));
            }
            check(
              Number((await stock()).quantity) >= 0 &&
                Number((await stock()).quantity) <= 5,
            );
            const supplierMatches = rows(
              await rpc(manager, "procurement_suppliers", {
                p_query: marker,
                p_limit: 100,
                p_offset: 0,
                p_supplier_id: null,
              }),
            );
            check(
              supplierMatches.length <= 1 &&
                supplierMatches.every((supplier) => supplier.name === marker),
            );
            if (supplierMatches.length)
              fixture.supplierId = supplierMatches[0].id;
            const purchases = fixture.supplierId
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
              purchases.length <= 1 &&
                purchases.every(
                  (purchase) => purchase.supplier_id === fixture.supplierId,
                ),
            );
            for (const purchase of purchases)
              if (purchase.status === "open")
                one(
                  await rpc(manager, "procurement_cancel_order", {
                    p_order_id: purchase.id,
                    p_expected_revision: String(purchase.revision),
                    p_reason: marker,
                    p_idempotency_key: randomUUID(),
                  }),
                );
            const allowedReasons = new Set([
              `Compensação ${marker}`,
              ...purchases
                .filter((purchase) => purchase.status === "received")
                .map((purchase) => `Recebimento de compra ${purchase.id}`),
              ...orders
                .filter((order) => order.sale_id)
                .flatMap((order) => [
                  `Venda ${order.sale_id}`,
                  `Cancelamento de venda ${order.sale_id}`,
                ]),
            ]);
            const movements = data(
              await admin
                .from("inventory_movements")
                .select("actor_user_id,kind,quantity,reason")
                .eq("organization_id", ORG)
                .eq("store_id", STORE)
                .eq("variant_id", fixture.variantId),
            );
            check(
              movements.every(
                (movement) =>
                  [manager.id, cashier.id].includes(movement.actor_user_id) &&
                  allowedReasons.has(movement.reason),
              ),
            );
            const expected = movements.reduce(
              (total, movement) =>
                total +
                (movement.kind === "entry" ? 1 : -1) *
                  Number(movement.quantity),
              0,
            );
            const balance = await stock();
            check(
              Number(balance.quantity) === expected &&
                expected >= 0 &&
                expected <= 5,
            );
            if (expected > 0)
              one(
                await rpc(manager, "inventory_move", {
                  p_variant_id: fixture.variantId,
                  p_kind: "exit",
                  p_quantity: expected,
                  p_reason: `Compensação ${marker}`,
                  p_expected_revision: String(balance.revision),
                  p_idempotency_key: randomUUID(),
                }),
              );
            check(Number((await stock()).quantity) === 0);
          }
          report.compensated = true;
        });
      } catch {
        /* Preserve failing phase and journal. */
      }
      try {
        await stage("postflight_archive", async () => {
          check(report.compensated && !unresolvedMutation);
          if (fixture.supplierId) {
            const supplier = one(
              await rpc(manager, "procurement_suppliers", {
                p_query: "",
                p_limit: 1,
                p_offset: 0,
                p_supplier_id: fixture.supplierId,
              }),
            );
            check(supplier.name === marker);
            if (supplier.active)
              one(
                await rpc(manager, "procurement_save_supplier", {
                  p_supplier_id: supplier.id,
                  p_name: supplier.name,
                  p_contact: supplier.contact,
                  p_active: false,
                  p_expected_revision: String(supplier.revision),
                  p_idempotency_key: randomUUID(),
                }),
              );
          }
          if (fixture.productId) {
            const product = data(
              await admin
                .from("products")
                .select("id,name,description,category_id,revision,active")
                .eq("organization_id", ORG)
                .eq("id", fixture.productId)
                .single(),
            );
            check(product.name === marker);
            if (product.active)
              one(
                await rpc(manager, "catalog_update_product", {
                  p_product_id: product.id,
                  p_expected_revision: String(product.revision),
                  p_name: product.name,
                  p_description: product.description,
                  p_category_id: product.category_id,
                  p_active: false,
                }),
              );
          }
          const customers = data(
            await admin
              .from("customers")
              .select(
                "id,name,phone,email,active,revision,actor_user_id,created_at",
              )
              .eq("organization_id", ORG)
              .ilike("name", `${marker}%`),
          );
          check(
            customers.length <= 2 &&
              customers.every(
                (customer) =>
                  [marker, `${marker} SEM TELEFONE`].includes(customer.name) &&
                  customer.actor_user_id === manager.id &&
                  Date.parse(customer.created_at) >=
                    Date.parse(report.started_at) - 60000,
              ),
          );
          for (const customer of customers) {
            if (customer.active)
              one(
                await customerSave({
                  id: customer.id,
                  revision: String(customer.revision),
                  name: customer.name,
                  phone: customer.phone,
                  email: customer.email,
                  active: false,
                }),
              );
          }
          check(
            !fixture.customerId ||
              customers.some((customer) => customer.id === fixture.customerId),
          );
          check(
            !fixture.noPhoneCustomerId ||
              customers.some(
                (customer) => customer.id === fixture.noPhoneCustomerId,
              ),
          );
          report.archived = true;
        });
      } catch {
        /* Preserve immutable business history. */
      }
    }
    if (browser)
      try {
        await browser.close();
      } catch {
        report.failed_phase ??= "postflight_archive";
      }
    report.finished_at = new Date().toISOString();
    report.unresolved_mutation = unresolvedMutation;
    if (
      !report.failed_phase &&
      report.compensated &&
      report.archived &&
      !unresolvedMutation
    )
      report.status = "passed";
  }
  return sanitizeOrdersReport(report);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.warn = () => {};
  console.error = () => {};
  try {
    const report = await runHostedOrders();
    process.stdout.write(JSON.stringify(report));
    process.exitCode = report.status === "passed" ? 0 : 1;
  } catch {
    process.stdout.write(
      JSON.stringify({
        schema_version: 1,
        status: "failed",
        failed_phase: "configuration",
        checks: [],
        cleanup_retry: "not_run",
      }),
    );
    process.exitCode = 1;
  }
}
