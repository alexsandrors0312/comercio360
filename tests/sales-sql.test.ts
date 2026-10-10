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
const org = "10000000-0000-4000-8000-000000000001",
  otherOrg = "20000000-0000-4000-8000-000000000001";
const store = "10000000-0000-4000-8000-000000000011",
  store2 = "10000000-0000-4000-8000-000000000012",
  otherStore = "20000000-0000-4000-8000-000000000011";
const manager = "a0000000-0000-4000-8000-000000000001",
  otherManager = "b0000000-0000-4000-8000-000000000001",
  cashier = "c0000000-0000-4000-8000-000000000001";
type Result = { id: string; revision: number };
type Line = {
  variant_id: string;
  quantity: number;
  expected_unit_price_cents: number;
};
let db: PGlite;
let variants: string[], products: string[];
async function user(id: string) {
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
async function deferred() {
  await db.exec(
    "set constraints sale_total,sale_item_total immediate; set constraints sale_total,sale_item_total deferred",
  );
}
const lines = (): Line[] =>
  variants.map((variant_id, index) => ({
    variant_id,
    quantity: 2,
    expected_unit_price_cents: index === 0 ? 1234 : 0,
  }));
async function confirm(
  items: unknown = lines(),
  key: string | null = randomUUID(),
  o = org,
  s = store,
) {
  const result = (
    await db.query<Result>("select * from public.sales_confirm($1,$2,$3,$4)", [
      o,
      s,
      JSON.stringify(items),
      key,
    ])
  ).rows[0];
  await deferred();
  return result;
}
async function cancel(
  id: string,
  revision: string | null = "1",
  reason: string | null = "Retorno integral",
  key: string | null = randomUUID(),
  o = org,
  s = store,
) {
  const result = (
    await db.query<Result>(
      "select * from public.sales_cancel($1,$2,$3,$4,$5,$6)",
      [o, s, id, revision, reason, key],
    )
  ).rows[0];
  await deferred();
  return result;
}
async function list(
  query = "",
  status = "all",
  o = org,
  s = store,
  limit = 20,
  offset = 0,
  id: string | null = null,
) {
  return (
    await db.query<{
      id: string;
      status: string;
      revision: number;
      total_cents: number;
      cancellation_reason: string | null;
      total_count: number;
    }>("select * from public.sales_list($1,$2,$3,$4,$5,$6,$7)", [
      o,
      s,
      query,
      status,
      limit,
      offset,
      id,
    ])
  ).rows;
}
async function stock() {
  return (
    await db.query<{ variant_id: string; quantity: number; revision: number }>(
      "select variant_id,quantity,revision from public.inventory_balances order by variant_id",
    )
  ).rows;
}
async function readItems(id: string, o = org, s = store) {
  return (
    await db.query<{
      variant_id: string;
      product_name: string;
      sku: string;
      quantity: number;
      unit_price_cents: number;
    }>("select * from public.sales_items($1,$2,$3)", [o, s, id])
  ).rows;
}
async function count(table: string) {
  return Number(
    (await db.query<{ n: number }>(`select count(*) n from ${table}`)).rows[0]
      .n,
  );
}
async function admin(command: string, params: unknown[] = []) {
  await db.exec("reset role");
  await db.query(command, params);
  await user(manager);
}

describe("PDV 005 SQL real (PGlite; multi-session concurrency not executed)", () => {
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
    await db.exec(
      `create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null,file_size_limit integer,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;`,
    );
    for (const file of [
      "202609300002_catalog_storage.sql",
      "202609300003_catalog_image_attestation.sql",
      "202610020001_catalog_service_role_normalization.sql",
      "202610030001_catalog_conflict_http.sql",
      "202610090001_inventory.sql",
      "202610090002_procurement.sql",
      "202610090003_sales.sql",
    ])
      await db.exec(sql("migrations/" + file));
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.exec("begin");
    await user(manager);
    variants = [];
    products = [];
    for (let index = 0; index < 2; index++) {
      const product = (
        await db.query<Result>(
          "select * from public.catalog_create_product($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            org,
            store,
            "Produto fictício " + index,
            null,
            null,
            "SKU-" + index,
            "Azul",
            "M",
            "BAR-" + index,
            randomUUID(),
          ],
        )
      ).rows[0];
      products.push(product.id);
      variants.push(
        (
          await db.query<{ id: string }>(
            "select id from public.product_variants where product_id=$1",
            [product.id],
          )
        ).rows[0].id,
      );
      await db.query("select * from public.catalog_set_price($1,$2,$3,$4,$5)", [
        org,
        store,
        variants[index],
        null,
        index === 0 ? "12.34" : "0",
      ]);
      await db.query(
        "select * from public.inventory_move($1,$2,$3,'entry',10,'Estoque fictício',0,$4)",
        [org, store, variants[index], randomUUID()],
      );
    }
  });
  afterEach(async () => {
    await db.exec("rollback;reset role");
  });
  it("applies incremental RLS, exact price snapshots, stock exit and audit", async () => {
    expect(
      (
        await db.query<{ relrowsecurity: boolean }>(
          "select relrowsecurity from pg_class where relname in ('sales','sale_items','sales_requests')",
        )
      ).rows.every((r) => r.relrowsecurity),
    ).toBe(true);
    const before = await count("public.audit_events");
    const sale = await confirm();
    expect(sale.revision).toBe(1);
    expect((await list())[0]).toMatchObject({
      id: sale.id,
      status: "confirmed",
      total_cents: 2468,
    });
    expect((await stock()).map((r) => r.quantity)).toEqual([8, 8]);
    expect(
      (await readItems(sale.id))
        .map((i) => i.unit_price_cents)
        .sort((a, b) => a - b),
    ).toEqual([0, 1234]);
    expect(await count("public.audit_events")).toBe(before + 5);
  });
  it("allows cashier confirmation but denies cancellation and manual stock movement", async () => {
    await user(cashier);
    const sale = await confirm();
    expect(await list()).toHaveLength(1);
    await denied(() => cancel(sale.id), "42501");
    await denied(
      () =>
        db.query(
          "select * from public.inventory_move($1,$2,$3,'entry',1,'Entrada manual',2,$4)",
          [org, store, variants[0], randomUUID()],
        ),
      "42501",
    );
    await user(manager);
    expect((await cancel(sale.id)).revision).toBe(2);
  });
  it.each(["buyer", "stockist"])(
    "denies sales to %s without denying inventory/catalog",
    async (role) => {
      await admin("update public.memberships set role=$1 where user_id=$2", [
        role,
        manager,
      ]);
      await denied(() => confirm(), "42501");
      await denied(() => list(), "42501");
      expect((await db.query("select * from public.sales")).rows).toHaveLength(
        0,
      );
      expect(
        (
          await db.query(
            "select * from public.inventory_stock($1,$2,'',20,0)",
            [org, store],
          )
        ).rows,
      ).toHaveLength(2);
    },
  );
  it("owner still needs explicit store access", async () => {
    await admin("update public.memberships set role='owner' where user_id=$1", [
      manager,
    ]);
    await admin(
      "delete from public.user_store_access where organization_id=$1 and store_id=$2 and membership_id=(select id from public.memberships where user_id=$3)",
      [org, store, manager],
    );
    await denied(() => confirm(), "42501");
    await denied(() => list(), "42501");
  });
  it("isolates tenants and stores for RPCs and direct select", async () => {
    const sale = await confirm();
    await user(otherManager);
    await denied(() => list(), "42501");
    expect(await list("", "all", otherOrg, otherStore)).toHaveLength(0);
    expect((await db.query("select * from public.sales")).rows).toHaveLength(0);
    await denied(() => readItems(sale.id, otherOrg, otherStore), "42501");
    await denied(
      () =>
        cancel(
          sale.id,
          "1",
          "Retorno integral",
          randomUUID(),
          otherOrg,
          otherStore,
        ),
      "42501",
    );
    await user(manager);
    expect(await list("", "all", org, store2)).toHaveLength(0);
    await denied(() => readItems(sale.id, org, store2), "42501");
    await denied(
      () => cancel(sale.id, "1", "Retorno integral", randomUUID(), org, store2),
      "42501",
    );
  });
  it("rejects foreign variant with otherwise authorized scope", async () => {
    await user(otherManager);
    const product = (
      await db.query<Result>(
        "select * from public.catalog_create_product($1,$2,'Outro',null,null,'OUTRO',null,null,null,$3)",
        [otherOrg, otherStore, randomUUID()],
      )
    ).rows[0];
    const variant = (
      await db.query<{ id: string }>(
        "select id from public.product_variants where product_id=$1",
        [product.id],
      )
    ).rows[0].id;
    await user(manager);
    await denied(
      () =>
        confirm([
          { variant_id: variant, quantity: 1, expected_unit_price_cents: 0 },
        ]),
      "42501",
    );
  });
  it.each(["membership", "grant", "store", "role"])(
    "reauthorizes replay after %s revocation",
    async (target) => {
      const key = randomUUID();
      await confirm(lines(), key);
      await db.exec("reset role");
      if (target === "membership")
        await db.query(
          "update public.memberships set active=false where user_id=$1",
          [manager],
        );
      if (target === "role")
        await db.query(
          "update public.memberships set role='buyer' where user_id=$1",
          [manager],
        );
      if (target === "grant")
        await db.query(
          "delete from public.user_store_access where organization_id=$1 and store_id=$2 and membership_id=(select id from public.memberships where user_id=$3)",
          [org, store, manager],
        );
      if (target === "store")
        await db.query("update public.stores set active=false where id=$1", [
          store,
        ]);
      await user(manager);
      await denied(() => confirm(lines(), key), "42501");
      await denied(() => list(), "42501");
    },
  );
  it("replays reordered normalized lines even after price change, deactivation and cancellation", async () => {
    const key = randomUUID(),
      sale = await confirm(lines(), key);
    await cancel(sale.id);
    await admin(
      "update public.products set active=false,name='Nome posterior' where id=$1",
      [products[0]],
    );
    await admin(
      "update public.product_prices set amount=99 where variant_id=$1",
      [variants[0]],
    );
    const before = await count("public.inventory_movements");
    expect(
      await confirm(
        lines()
          .reverse()
          .map((i) => ({ ...i, variant_id: i.variant_id.toUpperCase() })),
        key,
      ),
    ).toEqual(sale);
    expect(await count("public.inventory_movements")).toBe(before);
    expect(
      (await readItems(sale.id)).some(
        (i) => i.product_name === "Produto fictício 0",
      ),
    ).toBe(true);
  });
  it("conflicts on changed payload or operation for the same actor/key", async () => {
    const key = randomUUID(),
      sale = await confirm(lines(), key);
    await denied(() => confirm([{ ...lines()[0], quantity: 1 }], key), "PT409");
    await denied(() => cancel(sale.id, "1", "Retorno integral", key), "PT409");
  });
  it("separates actor idempotency namespaces", async () => {
    const key = randomUUID();
    const a = await confirm(lines(), key);
    await user(cashier);
    const b = await confirm(lines(), key);
    expect(a.id).not.toBe(b.id);
    expect((await stock()).map((r) => r.quantity)).toEqual([6, 6]);
  });
  it("compares current store price and rejects missing price without writes", async () => {
    const before = await count("public.audit_events");
    await denied(
      () => confirm([{ ...lines()[0], expected_unit_price_cents: 1235 }]),
      "PT409",
    );
    await denied(
      () =>
        confirm(
          [{ ...lines()[0], expected_unit_price_cents: 1234 }],
          randomUUID(),
          org,
          store2,
        ),
      "22023",
    );
    expect(await count("public.sales")).toBe(0);
    expect(await count("public.audit_events")).toBe(before);
    expect((await stock()).map((r) => r.quantity)).toEqual([10, 10]);
  });
  it.each(["product", "variant"])(
    "rejects inactive %s for confirmation",
    async (target) => {
      await admin(
        target === "product"
          ? "update public.products set active=false where id=$1"
          : "update public.product_variants set active=false where id=$1",
        [target === "product" ? products[0] : variants[0]],
      );
      await denied(() => confirm(), "22023");
      expect(await count("public.sales")).toBe(0);
    },
  );
  it("rolls back all lines, balance, audit and ledger on last-item insufficiency", async () => {
    const ordered = lines().sort((a, b) =>
      a.variant_id.localeCompare(b.variant_id),
    );
    ordered[1].quantity = 11;
    const before = await count("public.audit_events"),
      movements = await count("public.inventory_movements"),
      balances = await stock(),
      key = randomUUID();
    await denied(() => confirm(ordered, key), "PT422");
    expect(await stock()).toEqual(balances);
    expect(await count("public.sales")).toBe(0);
    expect(await count("public.sale_items")).toBe(0);
    expect(await count("public.audit_events")).toBe(before);
    expect(await count("public.inventory_movements")).toBe(movements);
    expect((await confirm(lines(), key)).revision).toBe(1);
  });
  it("rolls back when inventory audit insertion fails", async () => {
    await db.exec("reset role");
    await db.exec(
      `create function private.sales_test_audit_failure() returns trigger language plpgsql as $$begin if new.entity_type='inventory_movements' and new.action='inventory.exit' then raise exception 'Injected audit failure' using errcode='23514';end if;return new;end;$$;create trigger injected_sales_failure before insert on public.audit_events for each row execute function private.sales_test_audit_failure();`,
    );
    await user(manager);
    const before = await count("public.audit_events"),
      balances = await stock();
    await denied(() => confirm(), "23514");
    expect(await stock()).toEqual(balances);
    expect(await count("public.sales")).toBe(0);
    expect(await count("public.audit_events")).toBe(before);
  });
  it("cancel restores original quantities for inactive product/SKU and immutable snapshots", async () => {
    const sale = await confirm();
    const snapshots = await readItems(sale.id);
    await admin("update public.products set active=false where id=$1", [
      products[0],
    ]);
    await admin("update public.product_variants set active=false where id=$1", [
      variants[1],
    ]);
    const key = randomUUID(),
      result = await cancel(sale.id, "1", "\u00a0👕👕👕\ufeff", key);
    expect(result.revision).toBe(2);
    expect(await cancel(sale.id, "1", "👕👕👕", key)).toEqual(result);
    expect((await stock()).map((r) => r.quantity)).toEqual([10, 10]);
    expect(await readItems(sale.id)).toEqual(snapshots);
    expect((await list())[0]).toMatchObject({
      status: "cancelled",
      cancellation_reason: "👕👕👕",
    });
    await denied(() => cancel(sale.id, "2"), "PT409");
    await denied(() => cancel(sale.id, "1", "Outro motivo", key), "PT409");
  });
  it("CAS rejects stale cancel and permits a single restock", async () => {
    const sale = await confirm();
    await denied(() => cancel(sale.id, "2"), "PT409");
    await cancel(sale.id);
    await denied(() => cancel(sale.id, "1"), "PT409");
    expect((await stock()).map((r) => r.quantity)).toEqual([10, 10]);
  });
  it.each(["balance", "revision"])(
    "cancel rolls back all items on %s overflow",
    async (target) => {
      const sale = await confirm(),
        ordered = [...variants].sort();
      await admin(
        target === "balance"
          ? "update public.inventory_balances set quantity=2147483647 where variant_id=$1"
          : "update public.inventory_balances set revision=9223372036854775807 where variant_id=$1",
        [ordered[1]],
      );
      const before = await stock(),
        audits = await count("public.audit_events"),
        movements = await count("public.inventory_movements");
      await denied(() => cancel(sale.id), "22023");
      expect(await stock()).toEqual(before);
      expect((await list())[0].status).toBe("confirmed");
      expect(await count("public.audit_events")).toBe(audits);
      expect(await count("public.inventory_movements")).toBe(movements);
    },
  );
  it("confirmation rejects exhausted balance revision", async () => {
    await admin(
      "update public.inventory_balances set revision=9223372036854775807 where variant_id=$1",
      [variants[0]],
    );
    await denied(() => confirm(), "22023");
    expect(await count("public.sales")).toBe(0);
  });
  it("rejects invalid JSON shape, numeric types, counts and duplicates", async () => {
    const valid = lines()[0];
    for (const invalid of [
      null,
      {},
      4,
      [],
      Array(51).fill(valid),
      [null],
      ["x"],
      [4],
      [valid, valid],
      [valid, { ...valid, variant_id: valid.variant_id.toUpperCase() }],
      [{ ...valid, quantity: "1" }],
      [{ ...valid, quantity: 1.5 }],
      [{ ...valid, quantity: 0 }],
      [{ ...valid, quantity: 1000001 }],
      [{ ...valid, expected_unit_price_cents: "0" }],
      [{ ...valid, expected_unit_price_cents: -1 }],
      [{ ...valid, expected_unit_price_cents: 1000000000000 }],
      [{ ...valid, expected_unit_price_cents: 0.1 }],
      [{ ...valid, variant_id: null }],
      [{ ...valid, variant_id: "invalid" }],
      [{ ...valid, extra: 1 }],
      [{ variant_id: valid.variant_id, quantity: 1 }],
    ])
      await denied(() => confirm(invalid), "22023");
    await denied(() => confirm(lines(), null), "22023");
    expect(await count("public.sales")).toBe(0);
  });
  it("computes exact total ceiling, zero and huge intermediate overflow", async () => {
    await admin(
      "update public.product_prices set amount=9999999999.99 where variant_id=$1",
      [variants[0]],
    );
    await admin(
      "update public.product_prices set amount=0.01 where variant_id=$1",
      [variants[1]],
    );
    const accepted = [
      {
        variant_id: variants[0],
        quantity: 1,
        expected_unit_price_cents: 999999999999,
      },
      { variant_id: variants[1], quantity: 1, expected_unit_price_cents: 1 },
    ];
    const sale = await confirm(accepted);
    expect(
      (await list("", "all", org, store, 20, 0, sale.id))[0].total_cents,
    ).toBe(1000000000000);
    await denied(
      () => confirm([{ ...accepted[0], quantity: 1000000 }]),
      "22023",
    );
    await denied(
      () => confirm([{ ...accepted[0] }, { ...accepted[1], quantity: 2 }]),
      "22023",
    );
  });
  it("validates cancellation reason and revision boundaries", async () => {
    const sale = await confirm();
    for (const reason of [null, "ab", "👕".repeat(241)])
      await denied(() => cancel(sale.id, "1", reason), "22023");
    for (const revision of [null, "0", "-1"])
      await denied(() => cancel(sale.id, revision), "22023");
    await denied(() => cancel(sale.id, "1", "Retorno integral", null), "22023");
    expect((await cancel(sale.id, "1", "👕".repeat(240))).revision).toBe(2);
  });
  it("forbids DML/helper access to authenticated and service roles", async () => {
    const sale = await confirm();
    for (const role of ["authenticated", "service_role"]) {
      await db.exec("reset role;set role " + role);
      await denied(
        () =>
          db.query("update public.sales set status='cancelled' where id=$1", [
            sale.id,
          ]),
        "42501",
      );
      await denied(
        () =>
          db.query("delete from public.sale_items where sale_id=$1", [sale.id]),
        "42501",
      );
      await denied(
        () => db.query("select * from private.sales_requests"),
        "42501",
      );
      await denied(
        () =>
          db.query("select private.sales_move($1,$2,$3,1,$4,false)", [
            org,
            store,
            variants[0],
            sale.id,
          ]),
        "42501",
      );
    }
    await user(manager);
  });
  it("blocks administrative edits/deletes/truncate, late snapshots and fake cancellation", async () => {
    const sale = await confirm();
    await db.exec("reset role");
    await denied(
      () =>
        db.query("update public.sales set total_cents=0 where id=$1", [
          sale.id,
        ]),
      "23514",
    );
    await denied(
      () =>
        db.query(
          "update public.sales set status='cancelled',revision=2,cancelled_at=clock_timestamp(),cancellation_reason='Retorno integral' where id=$1",
          [sale.id],
        ),
      "42501",
    );
    for (const table of [
      "public.sales",
      "public.sale_items",
      "private.sales_requests",
    ]) {
      await denied(() => db.exec("delete from " + table), "42501");
      await denied(() => db.exec("truncate " + table + " cascade"), "42501");
    }
    await denied(
      () =>
        db.query("update public.sale_items set quantity=1 where sale_id=$1", [
          sale.id,
        ]),
      "42501",
    );
    await denied(
      () =>
        db.query(
          "update private.sales_requests set result_revision=2 where result_id=$1",
          [sale.id],
        ),
      "42501",
    );
    await denied(
      () =>
        db.query(
          "insert into public.sale_items select * from public.sale_items where sale_id=$1",
          [sale.id],
        ),
      "42501",
    );
    await user(manager);
    await cancel(sale.id);
    await db.exec("reset role");
    await denied(
      () =>
        db.query(
          "update public.sales set cancellation_reason='Outro motivo' where id=$1",
          [sale.id],
        ),
      "42501",
    );
  });
  it("enforces composite tenant FKs and deferred count/total for administrative inserts", async () => {
    await db.exec("reset role");
    await denied(
      () =>
        db.query(
          "insert into public.sales(organization_id,store_id,actor_user_id,item_count,total_cents) values($1,$2,$3,1,0)",
          [otherOrg, store, manager],
        ),
      "23503",
    );
    await denied(async () => {
      await db.query(
        "insert into public.sales(organization_id,store_id,actor_user_id,item_count,total_cents) values($1,$2,$3,1,0)",
        [org, store, manager],
      );
      await deferred();
    }, "23514");
  });
  it("filters/paginates live variants by name/SKU/barcode and snapshot history", async () => {
    expect(
      (
        await db.query(
          "select * from public.sales_variants($1,$2,'BAR-0',20,0)",
          [org, store],
        )
      ).rows,
    ).toHaveLength(1);
    const first = await confirm();
    await confirm();
    expect(await list("SKU-0")).toHaveLength(2);
    expect(await list("Produto fictício")).toHaveLength(2);
    expect((await list(first.id))[0].id).toBe(first.id);
    expect(await list("", "confirmed", org, store, 1, 0)).toHaveLength(1);
    expect((await list("", "confirmed", org, store, 1, 0))[0].total_count).toBe(
      2,
    );
    await cancel(first.id);
    expect(await list("", "cancelled")).toHaveLength(1);
    for (const args of [
      ["x".repeat(201), "all", 20, 0],
      ["", "wrong", 20, 0],
      ["", "all", 0, 0],
      ["", "all", 101, 0],
      ["", "all", 20, -1],
    ] as const)
      await denied(
        () => list(args[0], args[1], org, store, args[2], args[3]),
        "22023",
      );
    await denied(
      () =>
        db.query("select * from public.sales_variants($1,$2,'',0,0)", [
          org,
          store,
        ]),
      "22023",
    );
  });
  it("keeps purchase cost audit hidden to cashier and denies sales audit after revocation", async () => {
    const sale = await confirm();
    await user(cashier);
    await confirm();
    expect(
      (
        await db.query(
          "select * from public.audit_events where entity_type in ('purchase_orders','purchase_order_items','procurement_suppliers')",
        )
      ).rows,
    ).toHaveLength(0);
    await user(manager);
    await admin("update public.memberships set role='buyer' where user_id=$1", [
      manager,
    ]);
    expect(
      (
        await db.query(
          "select * from public.audit_events where entity_type in ('sales','sale_items')",
        )
      ).rows,
    ).toHaveLength(0);
    await denied(() => readItems(sale.id), "42501");
  });
  it("inspects stable lock order, definer search paths and helper grants", async () => {
    const migration = sql("migrations/202610090003_sales.sql");
    const variantLock = migration.slice(
      migration.indexOf("create function private.sales_lock_variants"),
      migration.indexOf("create function private.sales_lock_balances"),
    );
    expect(variantLock.indexOf("from public.products")).toBeLessThan(
      variantLock.indexOf(
        "from public.product_variants v where v.organization_id=p_org and v.id=any(p_variants) order by v.id",
      ),
    );
    expect(variantLock.indexOf("order by v.id for share")).toBeLessThan(
      variantLock.indexOf("from public.product_prices"),
    );
    const definition = migration.slice(
      migration.indexOf("create function public.sales_confirm"),
      migration.indexOf("create function public.sales_cancel"),
    );
    expect(definition.indexOf("private.sales_require_write")).toBeLessThan(
      definition.indexOf("private.sales_replay"),
    );
    expect(definition.indexOf("private.sales_replay")).toBeLessThan(
      definition.indexOf("private.sales_lock_variants"),
    );
    expect(definition.indexOf("private.sales_lock_variants")).toBeLessThan(
      definition.indexOf("private.sales_lock_balances"),
    );
    expect(definition).not.toContain("public.inventory_move");
    const functions = (
      await db.query<{ prosecdef: boolean; proconfig: string[] }>(
        "select prosecdef,proconfig from pg_proc where proname in ('sales_confirm','sales_cancel','sales_move','sales_replay')",
      )
    ).rows;
    expect(functions).toHaveLength(4);
    expect(
      functions.every(
        (f) => f.prosecdef && f.proconfig.includes('search_path=""'),
      ),
    ).toBe(true);
  });
});
