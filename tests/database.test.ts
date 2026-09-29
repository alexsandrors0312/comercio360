import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const sql = (path: string) =>
  readFileSync(new URL("../" + path, import.meta.url), "utf8");
const orgA = "10000000-0000-4000-8000-000000000001",
  orgB = "20000000-0000-4000-8000-000000000001";
const storeA = "10000000-0000-4000-8000-000000000011",
  storeA2 = "10000000-0000-4000-8000-000000000012",
  storeB = "20000000-0000-4000-8000-000000000011";
const uid = (letter: string) => `${letter}0000000-0000-4000-8000-000000000001`;
let db: PGlite;
async function asUser(letter: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    uid(letter),
  ]);
  await db.exec("set role authenticated");
}
async function count(table: string) {
  return (
    await db.query<{ n: number }>(
      `select count(*)::int as n from public.${table}`,
    )
  ).rows[0].n;
}
describe("PostgreSQL migration, RLS and audit", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(sql("supabase/tests/bootstrap.sql"));
    await db.exec(sql("supabase/migrations/202609070001_foundation.sql"));
    await db.exec(
      sql("supabase/migrations/202609080001_tenant_key_guards.sql"),
    );
    await db.exec(sql("supabase/seed.sql"));
    await db.exec(sql("supabase/tests/fixtures.sql"));
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  });
  it("seed is repeatable and every exposed foundation table enables RLS", async () => {
    await db.exec(sql("supabase/seed.sql"));
    expect(await count("organizations")).toBe(2);
    const rows = (
      await db.query<{ relrowsecurity: boolean }>(
        "select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'",
      )
    ).rows;
    expect(rows.length).toBe(6);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });
  it("A sees A only; explicit B reads yield zero rows", async () => {
    await asUser("a");
    expect(await count("organizations")).toBe(1);
    expect(await count("stores")).toBe(2);
    expect(await count("profiles")).toBe(1);
    expect(await count("memberships")).toBe(1);
    expect(await count("user_store_access")).toBe(2);
    for (const table of [
      "stores",
      "memberships",
      "user_store_access",
      "audit_events",
    ])
      expect(
        (
          await db.query(
            `select * from public.${table} where organization_id=$1`,
            [orgB],
          )
        ).rows,
      ).toHaveLength(0);
    expect(
      (await db.query("select * from public.organizations where id=$1", [orgB]))
        .rows,
    ).toHaveLength(0);
  });
  it("B cannot read A, including audit records", async () => {
    await asUser("b");
    expect(await count("stores")).toBe(1);
    for (const table of [
      "stores",
      "memberships",
      "user_store_access",
      "audit_events",
    ])
      expect(
        (
          await db.query(
            `select * from public.${table} where organization_id=$1`,
            [orgA],
          )
        ).rows,
      ).toHaveLength(0);
  });
  it("cashier cannot read or select an unauthorized store within A", async () => {
    await asUser("c");
    expect(await count("stores")).toBe(1);
    expect(
      (await db.query("select * from public.stores where id=$1", [storeA2]))
        .rows,
    ).toHaveLength(0);
    await expect(
      db.query("select public.set_active_store($1,$2)", [orgA, storeA2]),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("user without membership gets no business records and cannot select a store", async () => {
    await asUser("d");
    for (const table of [
      "organizations",
      "stores",
      "memberships",
      "user_store_access",
      "audit_events",
    ])
      expect(await count(table)).toBe(0);
    await expect(
      db.query("select public.set_active_store($1,$2)", [orgA, storeA]),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("anonymous reads and RPC are forbidden", async () => {
    await db.exec("set role anon");
    for (const table of [
      "organizations",
      "stores",
      "profiles",
      "memberships",
      "user_store_access",
      "audit_events",
    ])
      await expect(count(table)).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.query("select public.set_active_store($1,$2)", [orgA, storeA]),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("authorized context selection is audited once; repeated identical selection is idempotent", async () => {
    await asUser("a");
    await db.query("select public.set_active_store($1,$2)", [orgA, storeA]);
    await db.query("select public.set_active_store($1,$2)", [orgA, storeA]);
    const events = (
      await db.query<{
        actor_user_id: string;
        new_value: { store_id: string };
      }>(
        "select actor_user_id,new_value from public.audit_events where action='context.selected'",
      )
    ).rows;
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(uid("a"));
    expect(events[0].new_value.store_id).toBe(storeA);
    await db.query("select public.set_active_store($1,$2)", [orgA, storeA2]);
    const event = (
      await db.query<{ old_value: { store_id: string } }>(
        "select old_value from public.audit_events where action='context.selected' and store_id=$1",
        [storeA2],
      )
    ).rows[0];
    expect(event.old_value.store_id).toBe(storeA);
  });
  it("cross-tenant context and mismatched organization/store pairs fail", async () => {
    await asUser("a");
    await expect(
      db.query("select public.set_active_store($1,$2)", [orgB, storeB]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.query("select public.set_active_store($1,$2)", [orgA, storeB]),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("direct inserts, role escalation, deletions and audit tampering fail", async () => {
    await asUser("a");
    for (const table of [
      "organizations",
      "stores",
      "profiles",
      "memberships",
      "user_store_access",
      "audit_events",
    ]) {
      await expect(
        db.exec(`delete from public.${table}`),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        db.exec(`update public.${table} set updated_at=now()`),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        db.exec(`insert into public.${table} default values`),
      ).rejects.toMatchObject({ code: "42501" });
    }
    await expect(
      db.exec("update public.memberships set role='owner'"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(db.exec("truncate public.audit_events")).rejects.toMatchObject(
      { code: "42501" },
    );
  });
  it("composite foreign keys reject cross-organization store grants, even by a privileged writer", async () => {
    await expect(
      db.query(
        "insert into public.user_store_access(organization_id,membership_id,store_id) values($1,$2,$3)",
        [orgA, "a0000000-0000-4000-8000-000000000011", storeB],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });
  it("privileged membership changes record before and after, and audit rows are append-only", async () => {
    await db.query("update public.memberships set role=$1 where user_id=$2", [
      "owner",
      uid("a"),
    ]);
    const event = (
      await db.query<{
        old_value: { role: string };
        new_value: { role: string };
      }>(
        "select old_value,new_value from public.audit_events where entity_type='memberships' and action='update' order by created_at desc limit 1",
      )
    ).rows[0];
    expect(event.old_value.role).toBe("manager");
    expect(event.new_value.role).toBe("owner");
    await expect(
      db.exec("update public.audit_events set action='forged'"),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("revoking membership immediately removes store reads and RPC access", async () => {
    await db.query(
      "update public.memberships set active=false where user_id=$1",
      [uid("c")],
    );
    await asUser("c");
    expect(await count("stores")).toBe(0);
    expect(await count("organizations")).toBe(0);
    await expect(
      db.query("select public.set_active_store($1,$2)", [orgA, storeA]),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("deactivating a store removes it from reads and selection", async () => {
    await db.query("update public.stores set active=false where id=$1", [
      storeA2,
    ]);
    await asUser("a");
    expect(await count("stores")).toBe(1);
    await expect(
      db.query("select public.set_active_store($1,$2)", [orgA, storeA2]),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
