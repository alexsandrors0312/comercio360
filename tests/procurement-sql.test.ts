import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const sql = (path: string) =>
  readFileSync(new URL("../supabase/" + path, import.meta.url), "utf8");
const orgA = "10000000-0000-4000-8000-000000000001",
  orgB = "20000000-0000-4000-8000-000000000001";
const storeA = "10000000-0000-4000-8000-000000000011",
  storeA2 = "10000000-0000-4000-8000-000000000012",
  storeB = "20000000-0000-4000-8000-000000000011";
const managerA = "a0000000-0000-4000-8000-000000000001",
  managerB = "b0000000-0000-4000-8000-000000000001",
  cashierA = "c0000000-0000-4000-8000-000000000001";
type Result = { id: string; revision: number };
type Line = { variant_id: string; quantity: number; unit_cost_cents: number };
let db: PGlite;
let variantA: string,
  variantA2: string,
  variantB: string,
  productA: string,
  supplierA: string,
  supplierB: string;
const scope = (org = orgA, store = storeA) => [org, store];
async function asUser(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  await db.exec("set role authenticated");
}
async function denied(call: () => Promise<unknown>, code: string) {
  await db.exec("savepoint expected_error");
  try {
    await expect(call()).rejects.toMatchObject({ code });
  } finally {
    await db.exec(
      "rollback to savepoint expected_error; release savepoint expected_error",
    );
  }
}
async function checkDeferred() {
  await db.exec(
    "set constraints purchase_order_total,purchase_item_total immediate; set constraints purchase_order_total,purchase_item_total deferred",
  );
}
async function saveSupplier(
  options: {
    id?: string;
    org?: string;
    store?: string;
    name?: string | null;
    contact?: string | null;
    active?: boolean | null;
    revision?: string | null;
    key?: string | null;
  } = {},
) {
  const fallback = (key: keyof typeof options, value: unknown) =>
    Object.hasOwn(options, key) ? options[key] : value;
  return (
    await db.query<Result>(
      "select * from public.procurement_save_supplier($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        ...scope(options.org, options.store),
        options.id ?? randomUUID(),
        fallback("name", "Fornecedor Aurora"),
        fallback("contact", "Contato fictício"),
        fallback("active", true),
        fallback("revision", "0"),
        fallback("key", randomUUID()),
      ],
    )
  ).rows[0];
}
const lines = (): Line[] => [
  { variant_id: variantA, quantity: 5, unit_cost_cents: 1234 },
  { variant_id: variantA2, quantity: 3, unit_cost_cents: 2500 },
];
async function createOrder(
  options: {
    supplier?: string;
    org?: string;
    store?: string;
    items?: unknown;
    key?: string | null;
  } = {},
) {
  const result = (
    await db.query<Result>(
      "select * from public.procurement_create_order($1,$2,$3,$4,$5)",
      [
        ...scope(options.org, options.store),
        options.supplier ?? supplierA,
        JSON.stringify(
          Object.hasOwn(options, "items") ? options.items : lines(),
        ),
        Object.hasOwn(options, "key") ? options.key : randomUUID(),
      ],
    )
  ).rows[0];
  await checkDeferred();
  return result;
}
async function receive(
  id: string,
  revision = "1",
  key: string | null = randomUUID(),
  org = orgA,
  store = storeA,
) {
  const result = (
    await db.query<Result>(
      "select * from public.procurement_receive_order($1,$2,$3,$4,$5)",
      [...scope(org, store), id, revision, key],
    )
  ).rows[0];
  await checkDeferred();
  return result;
}
async function cancel(
  id: string,
  revision = "1",
  reason: string | null = "Compra cancelada",
  key: string | null = randomUUID(),
  org = orgA,
  store = storeA,
) {
  const result = (
    await db.query<Result>(
      "select * from public.procurement_cancel_order($1,$2,$3,$4,$5,$6)",
      [...scope(org, store), id, revision, reason, key],
    )
  ).rows[0];
  await checkDeferred();
  return result;
}
async function suppliers(
  org = orgA,
  store = storeA,
  query = "",
  limit = 20,
  offset = 0,
  id: string | null = null,
) {
  return (
    await db.query<{
      id: string;
      name: string;
      contact: string | null;
      active: boolean;
      revision: number;
      total_count: number;
    }>("select * from public.procurement_suppliers($1,$2,$3,$4,$5,$6)", [
      ...scope(org, store),
      query,
      limit,
      offset,
      id,
    ])
  ).rows;
}
async function orders(
  org = orgA,
  store = storeA,
  query = "",
  status = "all",
  limit = 20,
  offset = 0,
  id: string | null = null,
) {
  return (
    await db.query<{
      id: string;
      supplier_name: string;
      status: string;
      revision: number;
      total_cents: number;
      received_at: string | null;
      cancellation_reason: string | null;
      total_count: number;
    }>("select * from public.procurement_orders($1,$2,$3,$4,$5,$6,$7)", [
      ...scope(org, store),
      query,
      status,
      limit,
      offset,
      id,
    ])
  ).rows;
}
async function items(id: string, org = orgA, store = storeA) {
  return (
    await db.query<{
      variant_id: string;
      sku: string;
      product_name: string;
      quantity: number;
      unit_cost_cents: number;
    }>("select * from public.procurement_order_items($1,$2,$3)", [
      ...scope(org, store),
      id,
    ])
  ).rows;
}
async function stock() {
  return (
    await db.query<{ variant_id: string; quantity: number; revision: number }>(
      "select * from public.inventory_stock($1,$2,'',100,0)",
      scope(),
    )
  ).rows;
}
async function manual(variant = variantA, quantity = 2, revision = "0") {
  return db.query(
    "select * from public.inventory_move($1,$2,$3,'entry',$4,'Entrada manual',$5,$6)",
    [...scope(), variant, quantity, revision, randomUUID()],
  );
}

describe("Compras 004 SQL real (PGlite; concorrência multi-sessão não executada)", () => {
  beforeAll(async () => {
    db = new PGlite();
    for (const file of [
      "tests/bootstrap.sql",
      "migrations/202609070001_foundation.sql",
      "migrations/202609080001_tenant_key_guards.sql",
      "seed.sql",
      "tests/fixtures.sql",
      "migrations/202609300001_catalog.sql",
    ])
      await db.exec(sql(file));
    await db.exec(`create schema storage;
      create table storage.buckets(id text primary key,name text not null,public boolean not null,file_size_limit integer,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null);
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert on storage.objects to authenticated;`);
    for (const file of [
      "202609300002_catalog_storage.sql",
      "202609300003_catalog_image_attestation.sql",
      "202610020001_catalog_service_role_normalization.sql",
      "202610030001_catalog_conflict_http.sql",
      "202610090001_inventory.sql",
      "202610090002_procurement.sql",
    ])
      await db.exec(sql("migrations/" + file));
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.exec("begin");
    for (const [org, store, actor, sku, name] of [
      [orgA, storeA, managerA, "CAM-001", "Camiseta"],
      [orgA, storeA, managerA, "JAQ-002", "Jaqueta"],
      [orgB, storeB, managerB, "OUT-001", "Outro produto"],
    ]) {
      await asUser(actor);
      const product = (
        await db.query<Result>(
          "select * from public.catalog_create_product($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [org, store, name, null, null, sku, "Azul", "M", null, randomUUID()],
        )
      ).rows[0];
      const variant = (
        await db.query<{ id: string }>(
          "select id from public.product_variants where product_id=$1",
          [product.id],
        )
      ).rows[0];
      if (sku === "CAM-001") {
        productA = product.id;
        variantA = variant.id;
      } else if (sku === "JAQ-002") variantA2 = variant.id;
      else variantB = variant.id;
    }
    supplierB = (
      await saveSupplier({
        org: orgB,
        store: storeB,
        name: "Fornecedor Horizonte",
      })
    ).id;
    await asUser(managerA);
    supplierA = (await saveSupplier()).id;
    await db.query(
      "select set_config('app.catalog_store_id','',true),set_config('app.procurement_store_id','',true)",
    );
  });
  afterEach(async () => {
    await db.exec("rollback; reset role");
  });

  it("applies incrementally with RLS and keeps creation separate from stock", async () => {
    const tables = (
      await db.query<{ relrowsecurity: boolean }>(
        "select relrowsecurity from pg_class where relname in ('procurement_suppliers','purchase_orders','purchase_order_items','procurement_requests')",
      )
    ).rows;
    expect(tables).toHaveLength(4);
    expect(tables.every((table) => table.relrowsecurity)).toBe(true);
    const order = await createOrder();
    expect((await orders())[0]).toMatchObject({
      id: order.id,
      status: "open",
      revision: 1,
      total_cents: 13670,
      received_at: null,
    });
    expect(await items(order.id)).toHaveLength(2);
    expect(
      (await stock()).every((row) => row.quantity === 0 && row.revision === 0),
    ).toBe(true);
    expect(
      (await db.query("select * from public.inventory_movements")).rows,
    ).toHaveLength(0);
  });

  it("normalizes supplier boundaries, enforces name uniqueness per organization and CAS", async () => {
    const created = await saveSupplier({
      name: "\u00a0👕👕👕\ufeff",
      contact: " \u3000 ",
    });
    expect(
      (await suppliers(orgA, storeA, "", 20, 0, created.id))[0],
    ).toMatchObject({ name: "👕👕👕", contact: null, revision: 1 });
    await denied(
      () => saveSupplier({ name: "  FORNECEDOR AURORA\u00a0" }),
      "23505",
    );
    await denied(() => saveSupplier({ id: supplierA, revision: "0" }), "PT409");
    const changed = await saveSupplier({
      id: supplierA,
      name: "Fornecedor Renomeado",
      revision: "1",
      active: false,
    });
    expect(changed.revision).toBe(2);
    await denied(() => saveSupplier({ id: supplierA, revision: "1" }), "PT409");
    expect((await suppliers(orgA, storeA, "Renomeado"))[0].active).toBe(false);
    await asUser(managerB);
    expect(
      await saveSupplier({
        org: orgB,
        store: storeB,
        name: "Fornecedor Aurora",
      }),
    ).toMatchObject({ revision: 1 });
  });

  it("stores immutable supplier/product/SKU/cost snapshots without reading selling prices", async () => {
    const order = await createOrder();
    await saveSupplier({
      id: supplierA,
      name: "Nome posterior",
      contact: "Outro contato",
      revision: "1",
      active: false,
    });
    await db.exec("reset role");
    await db.query(
      "update public.products set name='Produto posterior' where id=$1",
      [productA],
    );
    await db.query(
      "update public.product_variants set sku='SKU-POSTERIOR' where id=$1",
      [variantA],
    );
    await asUser(managerA);
    expect((await orders())[0].supplier_name).toBe("Fornecedor Aurora");
    expect(
      (await items(order.id)).find((row) => row.variant_id === variantA),
    ).toMatchObject({
      sku: "CAM-001",
      product_name: "Camiseta",
      unit_cost_cents: 1234,
    });
    await denied(() => createOrder(), "22023");
    expect(await receive(order.id)).toMatchObject({ revision: 2 });
  });

  it("receives all lines atomically on top of current balances with inventory audit", async () => {
    await manual();
    const order = await createOrder();
    expect(await receive(order.id)).toMatchObject({
      id: order.id,
      revision: 2,
    });
    expect((await orders())[0]).toMatchObject({
      status: "received",
      revision: 2,
    });
    expect((await orders())[0].received_at).not.toBeNull();
    expect(
      (await stock()).find((row) => row.variant_id === variantA),
    ).toMatchObject({ quantity: 7, revision: 2 });
    expect(
      (await stock()).find((row) => row.variant_id === variantA2),
    ).toMatchObject({ quantity: 3, revision: 1 });
    const receipts = (
      await db.query<{ reason: string; actor_user_id: string }>(
        "select reason,actor_user_id from public.inventory_movements where reason like 'Recebimento%'",
      )
    ).rows;
    expect(receipts).toHaveLength(2);
    expect(
      receipts.every(
        (row) =>
          row.reason === "Recebimento de compra " + order.id &&
          row.actor_user_id === managerA,
      ),
    ).toBe(true);
    expect(
      (
        await db.query(
          "select id from public.audit_events where entity_type='inventory_movements' and new_value->>'reason' like 'Recebimento%'",
        )
      ).rows,
    ).toHaveLength(2);
  });

  it("cancels only open orders with normalized reason and no stock movement", async () => {
    const order = await createOrder();
    expect(await cancel(order.id, "1", "\u00a0👕👕👕\ufeff")).toMatchObject({
      revision: 2,
    });
    expect((await orders())[0]).toMatchObject({
      status: "cancelled",
      cancellation_reason: "👕👕👕",
      received_at: null,
    });
    expect(
      (await db.query("select * from public.inventory_movements")).rows,
    ).toHaveLength(0);
    await denied(() => cancel(order.id, "2"), "PT409");
    await denied(() => receive(order.id, "2"), "PT409");
  });

  it.each([
    "owner",
    "manager",
    "buyer",
    "stockist",
    "cashier",
    "marketing",
    "logistics",
    "driver",
  ])("enforces cost/read/manage/receive permissions for %s", async (role) => {
    const order = await createOrder();
    await db.exec("reset role");
    await db.query("update public.memberships set role=$1 where user_id=$2", [
      role,
      managerA,
    ]);
    await asUser(managerA);
    if (["owner", "manager", "buyer", "stockist"].includes(role)) {
      expect(await orders()).toHaveLength(1);
      expect(await suppliers()).toHaveLength(1);
      expect(await items(order.id)).toHaveLength(2);
      expect(
        (await db.query("select * from public.purchase_order_items")).rows,
      ).toHaveLength(2);
    } else {
      await denied(() => orders(), "42501");
      await denied(() => suppliers(), "42501");
      await denied(() => items(order.id), "42501");
      for (const table of [
        "procurement_suppliers",
        "purchase_orders",
        "purchase_order_items",
      ])
        expect(
          (await db.query("select * from public." + table)).rows,
        ).toHaveLength(0);
      expect(
        (
          await db.query(
            "select * from public.audit_events where entity_type in ('procurement_suppliers','purchase_orders','purchase_order_items')",
          )
        ).rows,
      ).toHaveLength(0);
    }
    if (["owner", "manager", "buyer"].includes(role)) {
      expect(
        await saveSupplier({ name: "Fornecedor adicional" }),
      ).toMatchObject({ revision: 1 });
      const second = await createOrder();
      expect(await cancel(second.id)).toMatchObject({ revision: 2 });
    } else {
      await denied(() => saveSupplier({ name: "Fornecedor negado" }), "42501");
      await denied(() => createOrder(), "42501");
      await denied(() => cancel(order.id), "42501");
    }
    if (["owner", "manager", "stockist"].includes(role))
      expect(await receive(order.id)).toMatchObject({ revision: 2 });
    else await denied(() => receive(order.id), "42501");
  });

  it("isolates tenants, foreign suppliers/variants/orders and same-organization stores", async () => {
    const order = await createOrder();
    const second = await createOrder({ store: storeA2 });
    await denied(() => createOrder({ supplier: supplierB }), "42501");
    await denied(
      () =>
        createOrder({
          items: [{ variant_id: variantB, quantity: 1, unit_cost_cents: 1 }],
        }),
      "42501",
    );
    await denied(
      () => createOrder({ org: orgB, store: storeB, supplier: supplierB }),
      "42501",
    );
    await denied(
      () => receive(order.id, "1", randomUUID(), orgA, storeA2),
      "42501",
    );
    await denied(
      () => cancel(order.id, "1", "Outro", randomUUID(), orgB, storeB),
      "42501",
    );
    await denied(() => items(second.id), "42501");
    await denied(() => saveSupplier({ id: supplierB }), "42501");
    await asUser(managerB);
    expect(await orders(orgB, storeB)).toHaveLength(0);
    expect(
      (await db.query("select * from public.purchase_order_items")).rows,
    ).toHaveLength(0);
    expect(
      (await db.query("select * from public.procurement_suppliers")).rows,
    ).toHaveLength(1);
    await denied(() => items(order.id, orgB, storeB), "42501");
    await db.exec("reset role");
    await db.query(
      "update public.memberships set role='buyer' where user_id=$1",
      [cashierA],
    );
    await asUser(cashierA);
    expect(await orders()).toHaveLength(1);
    await denied(() => orders(orgA, storeA2), "42501");
    expect(
      (await db.query("select id from public.purchase_orders")).rows,
    ).toEqual([{ id: order.id }]);
  });

  it.each(["grant", "membership", "store"])(
    "reauthorizes idempotent replay and reads after revoking %s",
    async (target) => {
      const key = randomUUID();
      const order = await createOrder({ key });
      await db.exec("reset role");
      if (target === "grant")
        await db.query(
          "delete from public.user_store_access where membership_id=$1",
          ["a0000000-0000-4000-8000-000000000011"],
        );
      if (target === "membership")
        await db.query(
          "update public.memberships set active=false where user_id=$1",
          [managerA],
        );
      if (target === "store")
        await db.query(
          "update public.stores set active=false where organization_id=$1",
          [orgA],
        );
      await asUser(managerA);
      await denied(() => createOrder({ key }), "42501");
      await denied(() => receive(order.id), "42501");
      await denied(() => cancel(order.id), "42501");
      await denied(() => saveSupplier(), "42501");
      await denied(() => orders(), "42501");
      await denied(() => suppliers(), "42501");
      await denied(() => items(order.id), "42501");
      for (const table of [
        "procurement_suppliers",
        "purchase_orders",
        "purchase_order_items",
      ])
        expect(
          (await db.query("select * from public." + table)).rows,
        ).toHaveLength(0);
    },
  );

  it("requires explicit store grant for owner and supports buyer creating for stockist to receive", async () => {
    await db.exec("reset role");
    await db.query(
      "update public.memberships set role='owner' where user_id=$1",
      [managerA],
    );
    await db.query(
      "delete from public.user_store_access where membership_id=$1 and store_id=$2",
      ["a0000000-0000-4000-8000-000000000011", storeA],
    );
    await asUser(managerA);
    await denied(() => createOrder(), "42501");
    expect(await createOrder({ store: storeA2 })).toMatchObject({
      revision: 1,
    });
    await db.exec("reset role");
    await db.query(
      "update public.memberships set role='buyer' where user_id=$1",
      [cashierA],
    );
    await asUser(cashierA);
    const order = await createOrder();
    await db.exec("reset role");
    await db.query(
      "update public.memberships set role='stockist' where user_id=$1",
      [cashierA],
    );
    await asUser(cashierA);
    expect(await receive(order.id)).toMatchObject({ revision: 2 });
  });

  it("replays normalized supplier/order payloads, preserves original revision and rejects reused operation keys", async () => {
    const supplierKey = randomUUID(),
      id = randomUUID();
    const original = await saveSupplier({
      id,
      key: supplierKey,
      name: "  Novo fornecedor  ",
      contact: " ",
    });
    await saveSupplier({ id, revision: "1", name: "Alterado" });
    expect(
      await saveSupplier({
        id,
        key: supplierKey,
        name: "Novo fornecedor",
        contact: "",
      }),
    ).toEqual(original);
    await denied(
      () => saveSupplier({ id, key: supplierKey, name: "Diferente" }),
      "PT409",
    );
    await denied(() => createOrder({ key: supplierKey }), "PT409");
    const orderKey = randomUUID(),
      created = await createOrder({ key: orderKey });
    expect(
      await createOrder({ key: orderKey, items: lines().reverse() }),
    ).toEqual(created);
    await denied(
      () =>
        createOrder({
          key: orderKey,
          items: [{ ...lines()[0], quantity: 6 }, lines()[1]],
        }),
      "PT409",
    );
    await denied(() => receive(created.id, "1", orderKey), "PT409");
    expect(await createOrder({ key: orderKey, store: storeA2 })).toMatchObject({
      revision: 1,
    });
    await db.exec("reset role");
    await db.query(
      "update public.memberships set role='buyer' where user_id=$1",
      [cashierA],
    );
    await asUser(cashierA);
    expect(await createOrder({ key: orderKey })).toMatchObject({ revision: 1 });
  });

  it("replays successful receiving without duplicate stock after later manual entry and rechecks role", async () => {
    const order = await createOrder(),
      key = randomUUID();
    const result = await receive(order.id, "1", key);
    await manual(variantA, 2, "1");
    expect(await receive(order.id, "1", key)).toEqual(result);
    expect(
      (await stock()).find((row) => row.variant_id === variantA)?.quantity,
    ).toBe(7);
    expect(
      (
        await db.query(
          "select * from public.inventory_movements where reason like 'Recebimento%'",
        )
      ).rows,
    ).toHaveLength(2);
    await denied(() => receive(order.id, "2", key), "PT409");
    await denied(() => receive(order.id, "2"), "PT409");
    await denied(() => cancel(order.id, "2"), "PT409");
    await db.exec("reset role");
    await db.query(
      "update public.memberships set role='buyer' where user_id=$1",
      [managerA],
    );
    await asUser(managerA);
    await denied(() => receive(order.id, "1", key), "42501");
  });

  it("replays normalized cancellation but rejects changed reason or stale transition revision", async () => {
    const order = await createOrder(),
      key = randomUUID();
    await denied(() => receive(order.id, "2"), "PT409");
    await denied(() => cancel(order.id, "2"), "PT409");
    const result = await cancel(order.id, "1", "  Compra cancelada  ", key);
    expect(await cancel(order.id, "1", "Compra cancelada", key)).toEqual(
      result,
    );
    await denied(() => cancel(order.id, "1", "Outro motivo", key), "PT409");
  });

  it.each(["product", "variant"])(
    "rejects inactive %s at creation and receiving without partial balances",
    async (target) => {
      const key = randomUUID(),
        order = await createOrder({ key });
      await db.exec("reset role");
      await db.query(
        target === "product"
          ? "update public.products set active=false where id=$1"
          : "update public.product_variants set active=false where id=$1",
        [target === "product" ? productA : variantA],
      );
      await asUser(managerA);
      await denied(() => createOrder(), "22023");
      await denied(() => receive(order.id), "22023");
      expect(await createOrder({ key })).toEqual(order);
      expect((await orders())[0].status).toBe("open");
      expect(
        (await db.query("select * from public.inventory_balances")).rows,
      ).toHaveLength(0);
    },
  );

  it("validates JSON shape/types, duplicates, integer ranges and total without float", async () => {
    const valid = lines()[0];
    for (const invalid of [
      null,
      {},
      4,
      [],
      Array(51).fill(valid),
      [null],
      ["line"],
      [4],
      [valid, valid],
      [{ ...valid, quantity: "1" }],
      [{ ...valid, quantity: 1.5 }],
      [{ ...valid, quantity: 0 }],
      [{ ...valid, quantity: 1000001 }],
      [{ ...valid, unit_cost_cents: "1" }],
      [{ ...valid, unit_cost_cents: 0 }],
      [{ ...valid, unit_cost_cents: 100000001 }],
      [{ ...valid, variant_id: null }],
      [{ ...valid, variant_id: "invalid" }],
      [{ ...valid, extra: 1 }],
      [{ variant_id: variantA, quantity: 1 }],
    ])
      await denied(() => createOrder({ items: invalid }), "22023");
    expect(
      await createOrder({
        items: [
          { variant_id: variantA, quantity: 1000, unit_cost_cents: 100000000 },
        ],
      }),
    ).toMatchObject({ revision: 1 });
    expect((await orders())[0].total_cents).toBe(100000000000);
    await denied(
      () =>
        createOrder({
          items: [
            {
              variant_id: variantA,
              quantity: 1001,
              unit_cost_cents: 100000000,
            },
          ],
        }),
      "22023",
    );
    await denied(() => createOrder({ key: null }), "22023");
  });

  it("accepts exactly fifty distinct lines and rejects a fifty-first", async () => {
    await db.exec("reset role");
    const variants = (
      await db.query<{ id: string }>(
        "insert into public.product_variants(organization_id,product_id,sku,size) select $1,$2,'FIFTY-'||n,n::text from generate_series(1,50) n returning id",
        [orgA, productA],
      )
    ).rows;
    await asUser(managerA);
    const fifty = variants.map((row) => ({
      variant_id: row.id,
      quantity: 1,
      unit_cost_cents: 1,
    }));
    const order = await createOrder({ items: fifty });
    expect(await items(order.id)).toHaveLength(50);
    expect((await orders())[0].total_cents).toBe(50);
    await denied(() => createOrder({ items: [...fifty, lines()[0]] }), "22023");
  });

  it("validates supplier/cancellation Unicode boundaries and required transition inputs", async () => {
    for (const invalid of [
      { name: null },
      { name: "👕👕" },
      { name: "a".repeat(121) },
      { contact: "a".repeat(161) },
      { active: null },
      { revision: null },
      { revision: "-1" },
      { key: null },
    ])
      await denied(() => saveSupplier(invalid), "22023");
    expect(
      await saveSupplier({ name: "👕".repeat(120), contact: "👕".repeat(160) }),
    ).toMatchObject({ revision: 1 });
    const order = await createOrder();
    for (const reason of [null, "\u00a0\ufeff", "👕👕", "a".repeat(241)])
      await denied(() => cancel(order.id, "1", reason), "22023");
    await denied(() => receive(order.id, "0"), "22023");
    await denied(() => receive(order.id, "1", null), "22023");
    await denied(() => cancel(order.id, "0"), "22023");
    await denied(() => cancel(order.id, "1", "Motivo", null), "22023");
  });

  it("rolls back an earlier received line when a later balance would overflow", async () => {
    const sorted = [variantA, variantA2].sort(),
      later = sorted[1];
    await manual(later, 1);
    await db.exec("reset role");
    await db.query(
      "update public.inventory_balances set quantity=2147483647 where variant_id=$1",
      [later],
    );
    await asUser(managerA);
    const order = await createOrder(),
      key = randomUUID();
    await denied(() => receive(order.id, "1", key), "22023");
    expect(
      (await stock()).find((row) => row.variant_id === sorted[0]),
    ).toMatchObject({ quantity: 0, revision: 0 });
    expect(
      (await stock()).find((row) => row.variant_id === later),
    ).toMatchObject({ quantity: 2147483647, revision: 1 });
    expect((await orders())[0]).toMatchObject({ status: "open", revision: 1 });
    expect(
      (
        await db.query(
          "select * from public.inventory_movements where reason like 'Recebimento%'",
        )
      ).rows,
    ).toHaveLength(0);
    await db.exec("reset role");
    await db.query(
      "update public.inventory_balances set quantity=1 where variant_id=$1",
      [later],
    );
    await asUser(managerA);
    expect(await receive(order.id, "1", key)).toMatchObject({ revision: 2 });
  });

  it.each(["second_inventory_line", "order_transition"])(
    "rolls back all receiving writes on audit failure at %s",
    async (point) => {
      const order = await createOrder(),
        key = randomUUID();
      await db.exec("reset role");
      if (point === "second_inventory_line")
        await db.exec(
          "alter table public.audit_events add constraint fail_procurement_test check(entity_type<>'inventory_movements' or new_value->>'variant_id'<>'" +
            [variantA, variantA2].sort()[1] +
            "')",
        );
      else
        await db.exec(
          "alter table public.audit_events add constraint fail_procurement_test check(entity_type<>'purchase_orders' or action<>'update')",
        );
      await asUser(managerA);
      await denied(() => receive(order.id, "1", key), "23514");
      expect(
        (await db.query("select * from public.inventory_movements")).rows,
      ).toHaveLength(0);
      expect(
        (await db.query("select * from public.inventory_balances")).rows,
      ).toHaveLength(0);
      expect((await orders())[0]).toMatchObject({
        status: "open",
        revision: 1,
      });
      await db.exec("reset role");
      await db.exec(
        "alter table public.audit_events drop constraint fail_procurement_test",
      );
      await asUser(managerA);
      expect(await receive(order.id, "1", key)).toMatchObject({ revision: 2 });
    },
  );

  it("rolls back supplier/header/lines/idempotency together if audit rejects creation", async () => {
    const key = randomUUID();
    await db.exec("reset role");
    await db.exec(
      "alter table public.audit_events add constraint fail_create_test check(entity_type<>'purchase_order_items')",
    );
    await asUser(managerA);
    await denied(() => createOrder({ key }), "23514");
    expect(await orders()).toHaveLength(0);
    expect(
      (await db.query("select * from public.purchase_order_items")).rows,
    ).toHaveLength(0);
    await db.exec("reset role");
    await db.exec(
      "alter table public.audit_events drop constraint fail_create_test",
    );
    await asUser(managerA);
    expect(await createOrder({ key })).toMatchObject({ revision: 1 });
  });

  it("enforces composite FKs and immutable supplier/order/line/idempotency identities", async () => {
    const order = await createOrder();
    await db.exec("reset role");
    await denied(
      () =>
        db.query(
          "update public.procurement_suppliers set organization_id=$1,revision=revision+1 where id=$2",
          [orgB, supplierA],
        ),
      "23514",
    );
    await denied(
      () =>
        db.query("update public.purchase_orders set store_id=$1 where id=$2", [
          storeA2,
          order.id,
        ]),
      "23514",
    );
    await denied(
      () =>
        db.query(
          "update public.purchase_orders set total_cents=1 where id=$1",
          [order.id],
        ),
      "23514",
    );
    await denied(
      () =>
        db.query(
          "insert into public.purchase_orders(organization_id,store_id,supplier_id,supplier_name,actor_user_id,item_count,total_cents) values($1,$2,$3,'Snapshot',$4,1,1)",
          [orgA, storeB, supplierA, managerA],
        ),
      "23503",
    );
    await denied(
      () =>
        db.query(
          "insert into public.purchase_orders(organization_id,store_id,supplier_id,supplier_name,actor_user_id,item_count,total_cents) values($1,$2,$3,'Snapshot',$4,1,1)",
          [orgA, storeA, supplierB, managerA],
        ),
      "23503",
    );
    for (const table of ["purchase_order_items", "procurement_requests"])
      for (const command of [
        "update public." + table + " set organization_id=organization_id",
        "delete from public." + table,
        "truncate public." + table + " cascade",
      ])
        await denied(() => db.exec(command), "42501");
    await denied(
      () =>
        db.query("delete from public.procurement_suppliers where id=$1", [
          supplierA,
        ]),
      "42501",
    );
  });

  it("rejects direct DML for application/service roles and keeps terminal orders immutable even for owner", async () => {
    const order = await createOrder();
    await receive(order.id);
    for (const role of ["authenticated", "service_role", "anon"]) {
      await db.exec("reset role; set role " + role);
      for (const table of [
        "procurement_suppliers",
        "purchase_orders",
        "purchase_order_items",
        "procurement_requests",
      ])
        for (const command of [
          "insert into public." + table + " default values",
          "update public." + table + " set organization_id=organization_id",
          "delete from public." + table,
          "truncate public." + table + " cascade",
        ])
          await denied(() => db.exec(command), "42501");
      await denied(
        () => db.exec("select * from public.procurement_requests"),
        "42501",
      );
      if (role !== "authenticated") await denied(() => suppliers(), "42501");
    }
    await db.exec("reset role");
    await denied(
      () =>
        db.query(
          "update public.purchase_orders set revision=revision+1 where id=$1",
          [order.id],
        ),
      "42501",
    );
    await denied(
      () =>
        db.query("delete from public.purchase_orders where id=$1", [order.id]),
      "42501",
    );
    await denied(
      () => db.exec("truncate public.purchase_orders cascade"),
      "42501",
    );
  });

  it("validates deferred line count and monetary total as database invariants", async () => {
    await db.exec("reset role");
    await denied(async () => {
      const invalid = (
        await db.query<Result>(
          "insert into public.purchase_orders(organization_id,store_id,supplier_id,supplier_name,actor_user_id,item_count,total_cents) values($1,$2,$3,'Snapshot',$4,1,1) returning id",
          [orgA, storeA, supplierA, managerA],
        )
      ).rows[0];
      await db.query(
        "insert into public.purchase_order_items(organization_id,store_id,order_id,variant_id,product_name,sku,quantity,unit_cost_cents) values($1,$2,$3,$4,'Produto','SKU',2,1)",
        [orgA, storeA, invalid.id, variantA],
      );
      await checkDeferred();
    }, "23514");
    await asUser(managerA);
    expect(await orders()).toHaveLength(0);
  });

  it("paginates/searches deterministically with literal queries and validates every read bound", async () => {
    const first = await createOrder();
    const second = await createOrder();
    await cancel(second.id);
    expect((await orders(orgA, storeA, "", "all", 1, 1))[0]).toMatchObject({
      id: first.id,
      total_count: 2,
    });
    expect((await orders(orgA, storeA, "", "cancelled"))[0].id).toBe(second.id);
    expect((await orders(orgA, storeA, first.id.slice(0, 8)))[0].id).toBe(
      first.id,
    );
    expect(await orders(orgA, storeA, "%")).toHaveLength(0);
    expect((await suppliers(orgA, storeA, "aurora"))[0].id).toBe(supplierA);
    expect(await suppliers(orgA, storeA, "%")).toHaveLength(0);
    expect(await orders(orgA, storeA, "", "all", 20, 0, first.id)).toHaveLength(
      1,
    );
    for (const [limit, offset] of [
      [0, 0],
      [101, 0],
      [1, -1],
    ]) {
      await denied(() => suppliers(orgA, storeA, "", limit, offset), "22023");
      await denied(
        () => orders(orgA, storeA, "", "all", limit, offset),
        "22023",
      );
    }
    await denied(() => orders(orgA, storeA, "", "invalid"), "22023");
    await denied(() => orders(orgA, storeA, "a".repeat(201)), "22023");
    await denied(() => suppliers(orgA, storeA, "a".repeat(201)), "22023");
  });
});
