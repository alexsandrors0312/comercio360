import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
  expect,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const orgA = "10000000-0000-4000-8000-000000000001",
  orgB = "20000000-0000-4000-8000-000000000001";
const storeA = "10000000-0000-4000-8000-000000000011",
  storeA2 = "10000000-0000-4000-8000-000000000012",
  storeB = "20000000-0000-4000-8000-000000000011";
const memberA = "a0000000-0000-4000-8000-000000000011",
  memberB = "b0000000-0000-4000-8000-000000000011";
const userA = "a0000000-0000-4000-8000-000000000001",
  userB = "b0000000-0000-4000-8000-000000000001";
const replacement = "90000000-0000-4000-8000-000000000001";
let db: PGlite;
async function snapshot() {
  const result = [];
  for (const table of [
    "organizations",
    "stores",
    "memberships",
    "user_store_access",
    "audit_events",
  ])
    result.push(
      (await db.query(`select * from public.${table} order by id`)).rows,
    );
  return result;
}
async function deny(query: string, params: unknown[] = []) {
  const before = await snapshot();
  await db.exec("savepoint denied");
  try {
    await expect(db.query(query, params)).rejects.toMatchObject({
      code: "23514",
    });
  } finally {
    await db.exec("rollback to savepoint denied; release savepoint denied");
  }
  expect(await snapshot()).toEqual(before);
}
describe("001.1 structural tenant keys and audit SQL", () => {
  beforeAll(async () => {
    db = new PGlite();
    for (const file of [
      "tests/bootstrap.sql",
      "migrations/202609070001_foundation.sql",
      "migrations/202609080001_tenant_key_guards.sql",
      "seed.sql",
      "tests/fixtures.sql",
    ])
      await db.exec(
        readFileSync(new URL("../supabase/" + file, import.meta.url), "utf8"),
      );
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.exec("begin");
  });
  afterEach(async () => {
    await db.exec("rollback; reset role");
  });
  for (const role of ["service_role", "postgres"]) {
    describe(role, () => {
      const cases: [string, string, string, string][] = [
        ["organizations", "id", orgA, replacement],
        ["stores", "id", storeA, replacement],
        ["stores", "organization_id", storeA, orgB],
        ["memberships", "id", memberA, replacement],
        ["memberships", "organization_id", memberA, orgB],
        ["memberships", "user_id", memberA, userB],
      ];
      it.each(cases)(
        "rejects %s.%s updates without changing data or audit",
        async (table, key, id, value) => {
          await db.exec(`set role ${role}`);
          await deny(`update public.${table} set ${key}=$1 where id=$2`, [
            value,
            id,
          ]);
        },
      );
      it.each(["id", "organization_id", "membership_id", "store_id"])(
        "rejects user_store_access.%s updates",
        async (key) => {
          const value = {
            id: replacement,
            organization_id: orgB,
            membership_id: memberB,
            store_id: storeB,
          }[key]!;
          await db.exec(`set role ${role}`);
          await deny(
            `update public.user_store_access set ${key}=$1 where membership_id=$2`,
            [value, memberA],
          );
        },
      );
      it("rejects jointly valid cross-tenant relationship rewrites", async () => {
        await db.exec(`set role ${role}`);
        await deny(
          "update public.user_store_access set organization_id=$1,membership_id=$2,store_id=$3 where membership_id=$4",
          [orgB, memberB, storeB, memberA],
        );
      });
      it("rejects retargeting an access to a different store in the same organization", async () => {
        await db.exec(`set role ${role}`);
        await deny(
          "update public.user_store_access set store_id=$1 where membership_id=$2 and store_id=$3",
          [storeA2, "c0000000-0000-4000-8000-000000000011", storeA],
        );
      });
    });
  }
  it("allows ordinary administrative updates and identical key values; audits stay in their original tenant", async () => {
    await db.exec("set role service_role");
    await db.query(
      "update public.stores set id=id,organization_id=organization_id,name=$1,active=false where id=$2",
      ["Nome fictício atualizado", storeA],
    );
    await db.query(
      "update public.memberships set user_id=user_id,organization_id=organization_id,role='owner',active=false where id=$1",
      [memberA],
    );
    await db.exec(
      "update public.user_store_access set membership_id=membership_id,store_id=store_id,organization_id=organization_id",
    );
    const events = (
      await db.query<{
        organization_id: string;
        old_value: { organization_id: string };
        new_value: { organization_id: string };
      }>(
        "select organization_id,old_value,new_value from public.audit_events where action='update'",
      )
    ).rows;
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.old_value.organization_id).toBe(event.organization_id);
      expect(event.new_value.organization_id).toBe(event.organization_id);
    }
  });
  it("rejects tenant changes even on unreferenced or deactivated records", async () => {
    await db.query(
      "insert into public.stores(id,organization_id,name,active) values($1,$2,$3,false)",
      [replacement, orgA, "Loja fictícia desativada"],
    );
    await db.query(
      "insert into public.memberships(id,organization_id,user_id,role,active) values($1,$2,$3,$4,false)",
      [replacement, orgA, "d0000000-0000-4000-8000-000000000001", "manager"],
    );
    await db.exec("set role service_role");
    await deny("update public.stores set organization_id=$1 where id=$2", [
      orgB,
      replacement,
    ]);
    await deny("update public.memberships set organization_id=$1 where id=$2", [
      orgB,
      replacement,
    ]);
  });
  it.each(["old_value", "new_value"])(
    "rejects an explicit foreign tenant in audit %s",
    async (field) => {
      await db.exec("set role service_role");
      await deny(
        `insert into public.audit_events(organization_id,action,entity_type,origin,${field}) values($1,'update','stores','test',$2::jsonb)`,
        [
          orgB,
          JSON.stringify({ organization_id: orgA, name: "Must not leak" }),
        ],
      );
    },
  );
  it("rejects another organization root snapshot in audit even without organization_id inside JSON", async () => {
    await db.exec("set role service_role");
    await deny(
      "insert into public.audit_events(organization_id,action,entity_type,origin,old_value) values($1,'update','organizations','test',$2::jsonb)",
      [orgB, JSON.stringify({ id: orgA })],
    );
  });
  it("authorized cross-organization selections never copy the previous organization into old_value", async () => {
    await db.query(
      "insert into public.memberships(id,organization_id,user_id,role) values($1,$2,$3,'manager')",
      [replacement, orgB, userA],
    );
    await db.query(
      "insert into public.user_store_access(organization_id,membership_id,store_id) values($1,$2,$3)",
      [orgB, replacement, storeB],
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      userA,
    ]);
    await db.exec("set local role authenticated");
    await db.query("select public.set_active_store($1,$2)", [orgA, storeA]);
    await db.query("select public.set_active_store($1,$2)", [orgB, storeB]);
    const events = (
      await db.query<{
        organization_id: string;
        old_value: unknown;
        new_value: { organization_id: string };
      }>(
        "select organization_id,old_value,new_value from public.audit_events where action='context.selected'",
      )
    ).rows;
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.old_value).toBeNull();
      expect(event.new_value.organization_id).toBe(event.organization_id);
    }
  });
});
