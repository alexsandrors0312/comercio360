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
const orgA = "10000000-0000-4000-8000-000000000001";
const orgB = "20000000-0000-4000-8000-000000000001";
const storeA = "10000000-0000-4000-8000-000000000011";
const storeA2 = "10000000-0000-4000-8000-000000000012";
const storeB = "20000000-0000-4000-8000-000000000011";
const managerA = "a0000000-0000-4000-8000-000000000001";
const managerB = "b0000000-0000-4000-8000-000000000001";
const cashierA = "c0000000-0000-4000-8000-000000000001";
let db: PGlite;
let variantA: string;
let variantB: string;
let productA: string;

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
async function move(
  options: {
    org?: string;
    store?: string;
    variant?: string;
    kind?: string | null;
    amount?: number | null;
    reason?: string | null;
    revision?: string | null;
    key?: string | null;
  } = {},
) {
  const value = (key: keyof typeof options, fallback: unknown) =>
    Object.hasOwn(options, key) ? options[key] : fallback;
  return (
    await db.query<{ id: string; revision: number; quantity: number }>(
      "select * from public.inventory_move($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        options.org ?? orgA,
        options.store ?? storeA,
        options.variant ?? variantA,
        value("kind", "entry"),
        value("amount", 10),
        value("reason", "Entrada inicial"),
        value("revision", "0"),
        value("key", randomUUID()),
      ],
    )
  ).rows[0];
}
async function stock(
  org = orgA,
  store = storeA,
  query = "",
  limit = 20,
  offset = 0,
  variant: string | null = null,
) {
  return (
    await db.query<{
      variant_id: string;
      product_name: string;
      sku: string;
      active: boolean;
      quantity: number;
      revision: number;
      total_count: number;
    }>("select * from public.inventory_stock($1,$2,$3,$4,$5,$6)", [
      org,
      store,
      query,
      limit,
      offset,
      variant,
    ])
  ).rows;
}
async function history(
  variant = variantA,
  org = orgA,
  store = storeA,
  limit = 20,
  offset = 0,
) {
  return (
    await db.query<{
      id: string;
      kind: string;
      quantity: number;
      reason: string;
      balance_after: number;
      total_count: number;
    }>("select * from public.inventory_history($1,$2,$3,$4,$5)", [
      org,
      store,
      variant,
      limit,
      offset,
    ])
  ).rows;
}

describe("Estoque 003 SQL real (PGlite; sem concorrência multi-sessão)", () => {
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
    await db.exec(`
      create schema storage;
      create table storage.buckets(id text primary key,name text not null,public boolean not null,
        file_size_limit integer,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null);
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated;
      grant select,insert on storage.objects to authenticated;
    `);
    for (const file of [
      "202609300002_catalog_storage.sql",
      "202609300003_catalog_image_attestation.sql",
      "202610020001_catalog_service_role_normalization.sql",
      "202610030001_catalog_conflict_http.sql",
      "202610090001_inventory.sql",
    ])
      await db.exec(sql("migrations/" + file));
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.exec("begin");
    for (const [org, store, actor, sku] of [
      [orgA, storeA, managerA, "CAM-001"],
      [orgB, storeB, managerB, "OUT-001"],
    ]) {
      await asUser(actor);
      const product = (
        await db.query<{ id: string }>(
          "select * from public.catalog_create_product($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            org,
            store,
            "Camiseta",
            null,
            null,
            sku,
            "Azul",
            "M",
            null,
            randomUUID(),
          ],
        )
      ).rows[0];
      const variant = (
        await db.query<{ id: string }>(
          "select id from public.product_variants where product_id=$1",
          [product.id],
        )
      ).rows[0];
      if (org === orgA) {
        productA = product.id;
        variantA = variant.id;
      } else variantB = variant.id;
    }
    await asUser(managerA);
    // Catalog RPCs set a transaction-local audit store; clear the last fixture's
    // store before database-owner maintenance in these isolated SQL tests.
    await db.query("select set_config('app.catalog_store_id','',true)");
  });
  afterEach(async () => {
    await db.exec("rollback; reset role");
  });

  it("applies after all seven existing migrations and exposes zero without writing a balance", async () => {
    expect(await stock()).toEqual([
      expect.objectContaining({
        variant_id: variantA,
        quantity: 0,
        revision: 0,
        total_count: 1,
        active: true,
      }),
    ]);
    expect(await history()).toEqual([]);
    expect(
      (await db.query("select * from public.inventory_balances")).rows,
    ).toEqual([]);
    const tables = (
      await db.query<{ relrowsecurity: boolean }>(
        "select relrowsecurity from pg_class where relname in ('inventory_balances','inventory_movements')",
      )
    ).rows;
    expect(tables).toHaveLength(2);
    expect(tables.every((table) => table.relrowsecurity)).toBe(true);
  });

  it("records entry and exit with resulting balance, revision, normalized Unicode reason and audit actor", async () => {
    const first = await move({ reason: "\u00a0\ufeff👕👕👕\u3000" });
    expect(first).toMatchObject({ quantity: 10, revision: 1 });
    const second = await move({
      kind: "exit",
      amount: 4,
      revision: "1",
      reason: "Venda manual",
    });
    expect(second).toMatchObject({ quantity: 6, revision: 2 });
    expect((await stock())[0]).toMatchObject({ quantity: 6, revision: 2 });
    const rows = await history();
    expect(rows.map((row) => row.id)).toEqual([second.id, first.id]);
    expect(rows[1].reason).toBe("👕👕👕");
    const audit = (
      await db.query<{
        actor_user_id: string;
        store_id: string;
        action: string;
        new_value: { balance_after: number };
      }>(
        "select actor_user_id,store_id,action,new_value from public.audit_events where entity_type='inventory_movements' order by created_at,id",
      )
    ).rows;
    expect(audit).toHaveLength(2);
    expect(
      audit.every(
        (row) => row.actor_user_id === managerA && row.store_id === storeA,
      ),
    ).toBe(true);
    expect(audit.map((row) => row.action).sort()).toEqual([
      "inventory.entry",
      "inventory.exit",
    ]);
    expect(audit.some((row) => row.new_value.balance_after === 6)).toBe(true);
  });

  it("keeps balances separate by store and isolates direct RLS plus RPCs across tenants", async () => {
    await move();
    await move({ store: storeA2, amount: 20 });
    expect((await stock(orgA, storeA2))[0].quantity).toBe(20);
    await denied(
      () => move({ org: orgB, store: storeB, variant: variantB }),
      "42501",
    );
    await denied(() => move({ store: storeB }), "42501");
    await denied(() => move({ variant: variantB }), "42501");
    await denied(() => stock(orgB, storeB), "42501");
    await denied(() => history(variantB), "42501");
    await asUser(managerB);
    expect(
      (await db.query("select * from public.inventory_balances")).rows,
    ).toEqual([]);
    expect(
      (await db.query("select * from public.inventory_movements")).rows,
    ).toEqual([]);
    expect(
      (
        await db.query(
          "select * from public.audit_events where entity_type='inventory_movements'",
        )
      ).rows,
    ).toEqual([]);
  });

  it.each([
    "owner",
    "manager",
    "stockist",
    "cashier",
    "buyer",
    "marketing",
    "logistics",
    "driver",
  ])("enforces read/write boundaries for role %s", async (role) => {
    await move();
    await db.exec("reset role");
    await db.query("update public.memberships set role=$1 where user_id=$2", [
      role,
      managerA,
    ]);
    await asUser(managerA);
    const readable = [
      "owner",
      "manager",
      "stockist",
      "cashier",
      "buyer",
    ].includes(role);
    if (readable) {
      expect(await stock()).toHaveLength(1);
      expect(await history()).toHaveLength(1);
      expect(
        (await db.query("select * from public.inventory_balances")).rows,
      ).toHaveLength(1);
      expect(
        (
          await db.query(
            "select * from public.audit_events where entity_type='inventory_movements'",
          )
        ).rows,
      ).toHaveLength(1);
    } else {
      await denied(() => stock(), "42501");
      await denied(() => history(), "42501");
      expect(
        (await db.query("select * from public.inventory_movements")).rows,
      ).toEqual([]);
      expect(
        (
          await db.query(
            "select * from public.audit_events where entity_type='inventory_movements'",
          )
        ).rows,
      ).toEqual([]);
    }
    if (["owner", "manager", "stockist"].includes(role))
      expect(await move({ revision: "1" })).toMatchObject({
        quantity: 20,
        revision: 2,
      });
    else await denied(() => move({ revision: "1" }), "42501");
  });

  it.each(["grant", "membership", "store"])(
    "reauthorizes reads and idempotent repeats after revoking %s",
    async (target) => {
      const key = randomUUID();
      await move({ key });
      await db.exec("reset role");
      if (target === "grant")
        await db.query(
          "delete from public.user_store_access where store_id=$1 and membership_id=$2",
          [storeA, "a0000000-0000-4000-8000-000000000011"],
        );
      if (target === "membership")
        await db.query(
          "update public.memberships set active=false where user_id=$1",
          [managerA],
        );
      if (target === "store")
        await db.query("update public.stores set active=false where id=$1", [
          storeA,
        ]);
      await asUser(managerA);
      await denied(() => move({ key }), "42501");
      await denied(() => stock(), "42501");
      await denied(() => history(), "42501");
      expect(
        (await db.query("select * from public.inventory_balances")).rows,
      ).toEqual([]);
      expect(
        (await db.query("select * from public.inventory_movements")).rows,
      ).toEqual([]);
      expect(
        (
          await db.query(
            "select * from public.audit_events where entity_type='inventory_movements'",
          )
        ).rows,
      ).toEqual([]);
    },
  );

  it("requires explicit owner store grant even when another store remains authorized", async () => {
    await db.exec("reset role");
    await db.query(
      "update public.memberships set role='owner' where user_id=$1",
      [managerA],
    );
    await db.query(
      "delete from public.user_store_access where store_id=$1 and membership_id=$2",
      [storeA, "a0000000-0000-4000-8000-000000000011"],
    );
    await asUser(managerA);
    await denied(() => move(), "42501");
    await denied(() => stock(), "42501");
    expect(await move({ store: storeA2 })).toMatchObject({
      quantity: 10,
      revision: 1,
    });
  });

  it.each(["product", "variant"])(
    "shows inactive %s balance/history and rejects new movement",
    async (target) => {
      const key = randomUUID();
      const first = await move({ key });
      await db.exec("reset role");
      await db.query(
        target === "product"
          ? "update public.products set active=false where id=$1"
          : "update public.product_variants set active=false where id=$1",
        [target === "product" ? productA : variantA],
      );
      await asUser(managerA);
      expect((await stock())[0]).toMatchObject({
        active: false,
        quantity: 10,
        revision: 1,
      });
      expect(await history()).toHaveLength(1);
      await denied(() => move({ revision: "1" }), "22023");
      expect(await move({ key })).toEqual(first);
    },
  );

  it("returns original idempotent result after later movement and conflicts on every payload dimension", async () => {
    const key = randomUUID();
    const first = await move({ key, reason: "  Recebimento  " });
    await move({ amount: 1, revision: "1" });
    expect(await move({ key, reason: "Recebimento" })).toEqual(first);
    expect((await stock())[0].quantity).toBe(11);
    for (const changed of [
      { amount: 11 },
      { reason: "Outro motivo" },
      { kind: "exit" },
      { revision: "1" },
      { variant: variantB },
    ])
      await denied(
        () => move({ key, reason: "Recebimento", ...changed }),
        "PT409",
      );
    expect(await history()).toHaveLength(2);
    // Same UUID in another store is a different operation.
    expect(await move({ key, store: storeA2 })).toMatchObject({
      quantity: 10,
      revision: 1,
    });
    // Same UUID by another authorized actor is also a different operation.
    await db.exec("reset role");
    await db.query(
      "update public.memberships set role='stockist' where user_id=$1",
      [cashierA],
    );
    await asUser(cashierA);
    expect(await move({ key, revision: "2" })).toMatchObject({
      quantity: 21,
      revision: 3,
    });
  });

  it("rejects stale revision including two first-entry intents and keeps original balance/history", async () => {
    await move();
    await denied(() => move(), "PT409");
    await denied(() => move({ revision: "2" }), "PT409");
    expect((await stock())[0]).toMatchObject({ quantity: 10, revision: 1 });
    expect(await history()).toHaveLength(1);
  });

  it("rejects insufficient first exit without leaving a zero balance and permits exact depletion", async () => {
    await denied(() => move({ kind: "exit", amount: 1 }), "PT422");
    expect(
      (await db.query("select * from public.inventory_balances")).rows,
    ).toEqual([]);
    await move();
    await denied(
      () => move({ kind: "exit", amount: 11, revision: "1" }),
      "PT422",
    );
    expect(
      await move({ kind: "exit", amount: 10, revision: "1" }),
    ).toMatchObject({ quantity: 0, revision: 2 });
  });

  it("validates nullable fields, quantity range, reason Unicode length and expected revision", async () => {
    for (const invalid of [
      { amount: 0 },
      { amount: -1 },
      { amount: 1000001 },
      { amount: null },
      { kind: "transfer" },
      { kind: null },
      { reason: "\u00a0\ufeff" },
      { reason: "👕👕" },
      { reason: "a".repeat(241) },
      { reason: null },
      { revision: "-1" },
      { revision: null },
      { key: null },
    ])
      await denied(() => move(invalid), "22023");
    expect(
      await move({ amount: 1000000, reason: "👕".repeat(240) }),
    ).toMatchObject({ quantity: 1000000, revision: 1 });
  });

  it("prevents signed integer overflow and CAS revision overflow without changing the balance", async () => {
    await move();
    await db.exec("reset role");
    await db.query(
      "update public.inventory_balances set quantity=2147483646 where organization_id=$1 and store_id=$2 and variant_id=$3",
      [orgA, storeA, variantA],
    );
    await asUser(managerA);
    expect(await move({ amount: 1, revision: "1" })).toMatchObject({
      quantity: 2147483647,
      revision: 2,
    });
    await denied(() => move({ amount: 1, revision: "2" }), "22023");
    await db.exec("reset role");
    await db.query(
      "update public.inventory_balances set revision=9223372036854775807 where organization_id=$1 and store_id=$2 and variant_id=$3",
      [orgA, storeA, variantA],
    );
    await asUser(managerA);
    await denied(
      () => move({ kind: "exit", amount: 1, revision: "9223372036854775807" }),
      "22023",
    );
    expect((await stock())[0].quantity).toBe(2147483647);
  });

  it("rolls balance, history and idempotency back when audit fails", async () => {
    await db.exec("reset role");
    await db.exec(
      "alter table public.audit_events add constraint inventory_test_failure check(entity_type<>'inventory_movements')",
    );
    await asUser(managerA);
    const key = randomUUID();
    await denied(() => move({ key }), "23514");
    expect(
      (await db.query("select * from public.inventory_balances")).rows,
    ).toEqual([]);
    expect(await history()).toEqual([]);
    await db.exec("reset role");
    await db.exec(
      "alter table public.audit_events drop constraint inventory_test_failure",
    );
    await asUser(managerA);
    expect(await move({ key })).toMatchObject({ quantity: 10, revision: 1 });
    expect(await history()).toHaveLength(1);
  });

  it("protects structural FKs and rejects cross-tenant relations even for database owner", async () => {
    await move();
    await db.exec("reset role");
    await denied(
      () =>
        db.query(
          "insert into public.inventory_balances(organization_id,store_id,variant_id) values($1,$2,$3)",
          [orgA, storeB, variantA],
        ),
      "23503",
    );
    await denied(
      () =>
        db.query(
          "insert into public.inventory_balances(organization_id,store_id,variant_id) values($1,$2,$3)",
          [orgA, storeA, variantB],
        ),
      "23503",
    );
    await denied(
      () =>
        db.query(
          "update public.inventory_balances set store_id=$1 where variant_id=$2",
          [storeA2, variantA],
        ),
      "23514",
    );
    await denied(
      () =>
        db.query(
          "update public.inventory_balances set quantity=-1 where variant_id=$1",
          [variantA],
        ),
      "23514",
    );
  });

  it("blocks direct application/service DML and immutable history/audit update-delete-truncate", async () => {
    const first = await move();
    for (const role of ["authenticated", "service_role", "anon"]) {
      await db.exec("reset role; set role " + role);
      for (const table of ["inventory_balances", "inventory_movements"])
        for (const command of [
          "insert into public." + table + " default values",
          "update public." + table + " set quantity=1",
          "delete from public." + table,
          "truncate public." + table,
        ])
          await denied(() => db.exec(command), "42501");
      if (role !== "authenticated") await denied(() => move(), "42501");
    }
    await db.exec("reset role");
    for (const table of ["inventory_movements", "audit_events"]) {
      const id =
        table === "inventory_movements"
          ? first.id
          : (
              await db.query<{ id: string }>(
                "select id from public.audit_events where entity_id=$1",
                [first.id],
              )
            ).rows[0].id;
      await denied(
        () =>
          db.query("update public." + table + " set id=id where id=$1", [id]),
        "42501",
      );
      await denied(
        () => db.query("delete from public." + table + " where id=$1", [id]),
        "42501",
      );
      await denied(() => db.exec("truncate public." + table), "42501");
    }
    await asUser(managerA);
    expect(await history()).toHaveLength(1);
  });

  it("paginates deterministically, treats wildcard text literally and validates every read bound", async () => {
    const first = await move();
    const second = await move({ revision: "1" });
    expect(await history(variantA, orgA, storeA, 1, 1)).toEqual([
      expect.objectContaining({ id: first.id, total_count: 2 }),
    ]);
    expect((await history(variantA, orgA, storeA, 1))[0].id).toBe(second.id);
    expect(await stock(orgA, storeA, "cam-001")).toHaveLength(1);
    expect(await stock(orgA, storeA, "miset")).toHaveLength(1);
    expect(await stock(orgA, storeA, "%")).toHaveLength(0);
    expect(await stock(orgA, storeA, "", 20, 0, variantA)).toHaveLength(1);
    expect(await stock(orgA, storeA, "", 20, 0, variantB)).toHaveLength(0);
    for (const [limit, offset] of [
      [0, 0],
      [101, 0],
      [1, -1],
    ]) {
      await denied(() => stock(orgA, storeA, "", limit, offset), "22023");
      await denied(
        () => history(variantA, orgA, storeA, limit, offset),
        "22023",
      );
    }
    await denied(() => stock(orgA, storeA, "a".repeat(201)), "22023");
  });
});
