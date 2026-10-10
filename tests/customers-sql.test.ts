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
const org = "10000000-0000-4000-8000-000000000001";
const otherOrg = "20000000-0000-4000-8000-000000000001";
const store = "10000000-0000-4000-8000-000000000011";
const store2 = "10000000-0000-4000-8000-000000000012";
const otherStore = "20000000-0000-4000-8000-000000000011";
const manager = "a0000000-0000-4000-8000-000000000001";
const otherManager = "b0000000-0000-4000-8000-000000000001";
const cashier = "c0000000-0000-4000-8000-000000000001";
type Result = { id: string; revision: number };
type Customer = Result & {
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  total_count: number;
};
let db: PGlite;
let variant: string;
async function user(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  await db.exec("set role authenticated");
}
async function admin(command: string, params: unknown[] = []) {
  await db.exec("reset role");
  await db.query(command, params);
  await user(manager);
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
async function count(table: string) {
  return Number(
    (await db.query<{ n: number }>(`select count(*) n from ${table}`)).rows[0]
      .n,
  );
}
async function save(
  customerId: string | null = null,
  expectedRevision: number | null = null,
  name = "Cliente Fictício",
  phone: string | null = null,
  email: string | null = null,
  active = true,
  key: string | null = randomUUID(),
  o = org,
  s = store,
) {
  return (
    await db.query<Result>(
      "select * from public.customers_save($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [o, s, customerId, expectedRevision, name, phone, email, active, key],
    )
  ).rows[0];
}
async function list(
  query = "",
  status = "all",
  o = org,
  s = store,
  id: string | null = null,
) {
  return (
    await db.query<Customer>(
      "select * from public.customers_list($1,$2,$3,$4,20,0,$5)",
      [o, s, query, status, id],
    )
  ).rows;
}
async function confirm(
  customerId: string | null,
  key = randomUUID(),
  old = false,
  price = 1234,
) {
  const lines = [
    { variant_id: variant, quantity: 1, expected_unit_price_cents: price },
  ];
  const call = old
    ? "select * from public.sales_confirm($1,$2,$3,$4)"
    : "select * from public.sales_confirm_v2($1,$2,$3,$4,$5)";
  const args = old
    ? [org, store, JSON.stringify(lines), key]
    : [org, store, JSON.stringify(lines), customerId, key];
  const result = (await db.query<Result>(call, args)).rows[0];
  await db.exec(
    "set constraints sale_total,sale_item_total immediate; set constraints sale_total,sale_item_total deferred",
  );
  return result;
}
async function saleCustomer(id: string, o = org, s = store) {
  return (
    await db.query<{
      customer_id: string | null;
      customer_name_snapshot: string | null;
    }>("select * from public.sales_customer($1,$2,$3)", [o, s, id])
  ).rows[0];
}

describe("Clientes 006 SQL real (PGlite; concurrent sessions covered on hosted PostgreSQL)", () => {
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
      "202610100001_customers.sql",
    ])
      await db.exec(sql("migrations/" + file));
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.exec("begin");
    await user(manager);
    const product = (
      await db.query<Result>(
        "select * from public.catalog_create_product($1,$2,'Produto Cliente',null,null,'CLI-001',null,null,null,$3)",
        [org, store, randomUUID()],
      )
    ).rows[0];
    variant = (
      await db.query<{ id: string }>(
        "select id from public.product_variants where product_id=$1",
        [product.id],
      )
    ).rows[0].id;
    await db.query("select * from public.catalog_set_price($1,$2,$3,$4,$5)", [
      org,
      store,
      variant,
      null,
      "12.34",
    ]);
    await db.query(
      "select * from public.inventory_move($1,$2,$3,'entry',10,'Estoque fictício',0,$4)",
      [org, store, variant, randomUUID()],
    );
  });
  afterEach(async () => {
    await db.exec("rollback;reset role");
  });

  it("creates and searches normalized contact; RLS and audit remain scoped", async () => {
    const before = await count("public.audit_events");
    const created = await save(
      null,
      null,
      "  Ana Cliente  ",
      "(11) 99999-8888",
      " ANA@EXAMPLE.COM ",
    );
    expect(created.revision).toBe(1);
    expect((await list("ana"))[0]).toMatchObject({
      id: created.id,
      name: "Ana Cliente",
      phone: "11999998888",
      email: "ana@example.com",
      active: true,
      total_count: 1,
    });
    expect(await list("99998888")).toHaveLength(1);
    expect(await list("example.com")).toHaveLength(1);
    expect(await count("public.audit_events")).toBe(before + 1);
    expect(
      (
        await db.query<{ relrowsecurity: boolean }>(
          "select relrowsecurity from pg_class where relname in ('customers','customer_requests')",
        )
      ).rows.every((r) => r.relrowsecurity),
    ).toBe(true);
    await user(otherManager);
    expect(
      (
        await db.query("select * from public.customers where id=$1", [
          created.id,
        ])
      ).rows,
    ).toHaveLength(0);
    await denied(() => list("", "all", org, store), "42501");
    await denied(
      () =>
        save(null, null, "Outro", null, null, true, randomUUID(), org, store),
      "42501",
    );
  });
  it("lets cashier create and read but denies edit; buyer and stockist cannot read", async () => {
    await user(cashier);
    const created = await save();
    expect(await list()).toHaveLength(1);
    await denied(() => save(created.id, 1, "Novo Nome"), "42501");
    for (const role of ["buyer", "stockist"]) {
      await admin("update public.memberships set role=$1 where user_id=$2", [
        role,
        cashier,
      ]);
      await user(cashier);
      await denied(() => list(), "42501");
      await denied(() => save(), "42501");
    }
  });
  it("requires active membership, role, store and explicit grant even for replay", async () => {
    const key = randomUUID();
    await save(null, null, "Cliente Revogado", null, null, true, key);
    for (const target of ["role", "grant", "membership", "store"]) {
      await admin(
        target === "role"
          ? "update public.memberships set role='buyer' where user_id=$1"
          : target === "grant"
            ? "delete from public.user_store_access where organization_id=$1 and store_id=$2 and membership_id=(select id from public.memberships where user_id=$3)"
            : target === "membership"
              ? "update public.memberships set active=false where user_id=$1"
              : "update public.stores set active=false where id=$1",
        target === "grant"
          ? [org, store, manager]
          : [target === "store" ? store : manager],
      );
      await denied(
        () => save(null, null, "Cliente Revogado", null, null, true, key),
        "42501",
      );
      await denied(() => list(), "42501");
      await db.exec("reset role");
      if (target === "role")
        await db.query(
          "update public.memberships set role='manager' where user_id=$1",
          [manager],
        );
      if (target === "membership")
        await db.query(
          "update public.memberships set active=true where user_id=$1",
          [manager],
        );
      if (target === "store")
        await db.query("update public.stores set active=true where id=$1", [
          store,
        ]);
      if (target === "grant")
        await db.query(
          "insert into public.user_store_access(organization_id,membership_id,store_id) select $1,id,$2 from public.memberships where user_id=$3",
          [org, store, manager],
        );
      await user(manager);
    }
  });
  it("uses CAS and key payload while preserving original replay after later changes", async () => {
    const key = randomUUID(),
      original = await save(null, null, "Nome Original", null, null, true, key);
    const changed = await save(
      original.id,
      1,
      "Nome Alterado",
      "11 99999 0000",
      null,
      true,
    );
    expect(changed.revision).toBe(2);
    expect(
      await save(null, null, "Nome Original", null, null, true, key),
    ).toEqual(original);
    await denied(
      () => save(null, null, "Outra Pessoa", null, null, true, key),
      "PT409",
    );
    await denied(() => save(original.id, 1, "Nome Desatualizado"), "PT409");
    const inactive = await save(
      original.id,
      2,
      "Nome Alterado",
      "11999990000",
      null,
      false,
    );
    expect(inactive.revision).toBe(3);
    expect(await list("", "inactive")).toHaveLength(1);
    expect(await list("", "active")).toHaveLength(0);
    expect(
      (await save(original.id, 3, "Nome Alterado", null, null, true)).revision,
    ).toBe(4);
  });
  it("isolates tenant and selected store history", async () => {
    const customer = await save();
    const sale = await confirm(customer.id);
    expect(
      (
        await db.query("select * from public.customers_sales($1,$2,$3,20,0)", [
          org,
          store,
          customer.id,
        ])
      ).rows,
    ).toMatchObject([{ id: sale.id, total_count: 1 }]);
    expect(
      (
        await db.query("select * from public.customers_sales($1,$2,$3,20,0)", [
          org,
          store2,
          customer.id,
        ])
      ).rows,
    ).toHaveLength(0);
    await denied(() => saleCustomer(sale.id, org, store2), "42501");
    await user(otherManager);
    await denied(() => saleCustomer(sale.id, otherOrg, otherStore), "42501");
    await denied(
      () =>
        db.query("select * from public.customers_sales($1,$2,$3,20,0)", [
          otherOrg,
          otherStore,
          customer.id,
        ]),
      "42501",
    );
  });
  it("binds customer snapshot atomically and preserves it after edit, inactive and cancellation", async () => {
    const customer = await save(null, null, "Cliente Original");
    const sale = await confirm(customer.id);
    expect(await saleCustomer(sale.id)).toEqual({
      customer_id: customer.id,
      customer_name_snapshot: "Cliente Original",
    });
    await save(customer.id, 1, "Cliente Posterior", null, null, false);
    await denied(() => confirm(customer.id), "22023");
    expect(await saleCustomer(sale.id)).toEqual({
      customer_id: customer.id,
      customer_name_snapshot: "Cliente Original",
    });
    await db.query(
      "select * from public.sales_cancel($1,$2,$3,1,'Devolução integral',$4)",
      [org, store, sale.id, randomUUID()],
    );
    expect(await saleCustomer(sale.id)).toEqual({
      customer_id: customer.id,
      customer_name_snapshot: "Cliente Original",
    });
  });
  it("preserves old sale RPC, null payload and replay across wrappers", async () => {
    const key = randomUUID(),
      original = await confirm(null, key, true);
    expect(await saleCustomer(original.id)).toEqual({
      customer_id: null,
      customer_name_snapshot: null,
    });
    expect(await confirm(null, key, false)).toEqual(original);
    await db.exec("reset role");
    const payload = (
      await db.query<{ payload: unknown }>(
        "select payload from private.sales_requests where result_id=$1",
        [original.id],
      )
    ).rows[0].payload;
    await user(manager);
    expect(payload).toEqual({
      items: [
        { variant_id: variant, quantity: 1, expected_unit_price_cents: 1234 },
      ],
    });
    const customer = await save();
    await denied(() => confirm(customer.id, key), "PT409");
  });
  it("replays a customer sale after editing/inactivation and rejects another customer", async () => {
    const first = await save(),
      second = await save(null, null, "Outro Cliente");
    const key = randomUUID(),
      sale = await confirm(first.id, key);
    await save(first.id, 1, "Nome Mudado", null, null, false);
    expect(await confirm(first.id, key)).toEqual(sale);
    await denied(() => confirm(second.id, key), "PT409");
    expect(await saleCustomer(sale.id)).toEqual({
      customer_id: first.id,
      customer_name_snapshot: "Cliente Fictício",
    });
  });
  it("rejects foreign or inactive customer without sale, movement, audit or ledger", async () => {
    await user(otherManager);
    const foreign = await save(
      null,
      null,
      "Cliente Externo",
      null,
      null,
      true,
      randomUUID(),
      otherOrg,
      otherStore,
    );
    await user(manager);
    const own = await save();
    await save(own.id, 1, "Cliente Fictício", null, null, false);
    const sales = await count("public.sales"),
      moves = await count("public.inventory_movements"),
      audits = await count("public.audit_events");
    await denied(() => confirm(foreign.id), "22023");
    await denied(() => confirm(own.id), "22023");
    expect(await count("public.sales")).toBe(sales);
    expect(await count("public.inventory_movements")).toBe(moves);
    expect(await count("public.audit_events")).toBe(audits);
  });
  it("rolls back a customer sale when stock or price is wrong", async () => {
    const customer = await save();
    const before = await count("public.audit_events"),
      moves = await count("public.inventory_movements");
    await denied(
      () => confirm(customer.id, randomUUID(), false, 1235),
      "PT409",
    );
    await db.query(
      "select * from public.inventory_move($1,$2,$3,'exit',10,'Esgotar fictício',1,$4)",
      [org, store, variant, randomUUID()],
    );
    const after = await count("public.audit_events"),
      afterMoves = await count("public.inventory_movements");
    await denied(() => confirm(customer.id), "PT422");
    expect(await count("public.sales")).toBe(0);
    expect(await count("public.inventory_movements")).toBe(afterMoves);
    expect(await count("public.audit_events")).toBe(after);
    expect(after).toBeGreaterThan(before);
    expect(afterMoves).toBeGreaterThan(moves);
  });
  it("denies direct writes and structural customer mutation", async () => {
    const c = await save();
    await denied(
      () =>
        db.query("update public.customers set name='Ataque' where id=$1", [
          c.id,
        ]),
      "42501",
    );
    await denied(
      () => db.query("delete from public.customers where id=$1", [c.id]),
      "42501",
    );
    await denied(
      () =>
        db.query(
          "update private.customer_requests set result_revision=9 where result_id=$1",
          [c.id],
        ),
      "42501",
    );
    await db.exec("reset role");
    await denied(
      () =>
        db.query(
          "update public.customers set organization_id=$1,revision=revision+1 where id=$2",
          [otherOrg, c.id],
        ),
      "23514",
    );
    await user(manager);
    expect((await list("", "all", org, store, c.id))[0].revision).toBe(1);
  });
  it("rolls back customer creation and edits when audit insertion fails", async () => {
    const customer = await save();
    await db.exec("reset role");
    await db.exec(`create function private.reject_customer_test_audit() returns trigger language plpgsql as $$begin if new.entity_type='customers' then raise exception 'Injected customer audit failure' using errcode='23514'; end if; return new; end;$$;
      create trigger injected_customer_audit before insert on public.audit_events for each row execute function private.reject_customer_test_audit();`);
    await user(manager);
    const beforeCustomers = await count("public.customers");
    const beforeAudit = await count("public.audit_events");
    await denied(() => save(null, null, "Falha Auditada"), "23514");
    await denied(
      () => save(customer.id, 1, "Nome Alterado"),
      "23514",
    );
    expect(await count("public.customers")).toBe(beforeCustomers);
    expect(await count("public.audit_events")).toBe(beforeAudit);
    expect((await list("", "all", org, store, customer.id))[0]).toMatchObject({
      name: "Cliente Fictício",
      revision: 1,
    });
    await db.exec("reset role");
    expect(await count("private.customer_requests")).toBe(1);
    await user(manager);
  });
  it("enforces sale snapshot pair, tenant FK and immutable association", async () => {
    const customer = await save();
    const sale = await confirm(customer.id);
    await db.exec("reset role");
    await denied(
      () => db.query("update public.sales set customer_name_snapshot='Alterado' where id=$1", [sale.id]),
      "23514",
    );
    await denied(
      () => db.query(
        "insert into public.sales(organization_id,store_id,actor_user_id,item_count,total_cents,customer_id) values($1,$2,$3,1,0,$4)",
        [org, store, manager, customer.id],
      ),
      "23514",
    );
    await user(otherManager);
    const foreign = await save(null, null, "Outro Tenant", null, null, true, randomUUID(), otherOrg, otherStore);
    await db.exec("reset role");
    await denied(
      () => db.query(
        "insert into public.sales(organization_id,store_id,actor_user_id,item_count,total_cents,customer_id,customer_name_snapshot) values($1,$2,$3,1,0,$4,'Outro Tenant')",
        [org, store, manager, foreign.id],
      ),
      "23503",
    );
    await user(manager);
    expect(await saleCustomer(sale.id)).toEqual({customer_id:customer.id,customer_name_snapshot:"Cliente Fictício"});
  });
  it("validates contact lengths, revision, key, search and pagination", async () => {
    await denied(() => save(null, null, "A"), "22023");
    await denied(() => save(null, null, "Nome\nControle"), "22023");
    await denied(() => save(null, null, "Nome\u0085Controle"), "22023");
    await denied(() => save(null, null, "Nome", "1234567"), "22023");
    await denied(() => save(null, null, "Nome", null, "sem-arroba"), "22023");
    await denied(() => save(null, null, "Nome", null, null, false), "22023");
    await denied(() => save(null, 1), "22023");
    await denied(
      () => save(null, null, "Nome", null, null, true, null),
      "22023",
    );
    await denied(
      () =>
        db.query(
          "select * from public.customers_list($1,$2,$3,'all',20,0,null)",
          [org, store, "x".repeat(201)],
        ),
      "22023",
    );
    await denied(
      () =>
        db.query(
          "select * from public.customers_list($1,$2,'','all',101,0,null)",
          [org, store],
        ),
      "22023",
    );
  });
});
