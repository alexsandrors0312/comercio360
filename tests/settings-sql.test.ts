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
const owner = "11111111-1111-4111-8111-111111111111",
  guest = "22222222-2222-4222-8222-222222222222",
  other = "33333333-3333-4333-8333-333333333333";
type Result = {
  id: string;
  revision: string;
  organizationId: string;
  storeId: string;
};
let db: PGlite, org: string, store: string, ownerMember: string;
async function asUser(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  await db.exec("set role authenticated");
}
async function admin(sql: string, values: unknown[] = []) {
  await db.exec("reset role");
  const r = await db.query(sql, values);
  await asUser(owner);
  return r;
}
async function denied(fn: () => Promise<unknown>, code: string) {
  await db.exec("savepoint negative");
  try {
    await expect(fn()).rejects.toMatchObject({ code });
  } finally {
    await db.exec("rollback to savepoint negative;release savepoint negative");
  }
}
async function onboard(key = randomUUID(), name = "Empresa fictícia") {
  return (
    await db.query<{ value: Result }>(
      "select public.settings_onboard($1,'Loja inicial','Proprietário fictício',$2) value",
      [name, key],
    )
  ).rows[0].value;
}
async function mutate(
  operation: string,
  payload: unknown,
  key = randomUUID(),
  o = org,
  s = store,
) {
  return (
    await db.query<{ value: Result }>(
      "select public.settings_mutate($1,$2,$3,$4,$5) value",
      [o, s, operation, JSON.stringify(payload), key],
    )
  ).rows[0].value;
}
async function read(o = org, s = store) {
  return (
    await db.query<{
      value: {
        organization: { id: string; revision: string };
        stores: {
          id: string;
          name: string;
          active: boolean;
          revision: string;
        }[];
        members: {
          id: string;
          userId: string;
          role: string;
          revision: string;
          active: boolean;
          storeIds: string[];
        }[];
        invitations: { id: string; email: string; revision: string }[];
      };
    }>("select public.settings_read($1,$2) value", [o, s])
  ).rows[0].value;
}
async function invite(
  role = "cashier",
  stores = [store],
  key = randomUUID(),
  code = randomUUID(),
) {
  const result = await mutate(
    "invite",
    { email: " GUEST@example.test ", role, storeIds: stores, code },
    key,
  );
  return { ...result, code, key };
}
async function accept(code: string, key = randomUUID()) {
  return (
    await db.query<{ value: Result }>(
      "select public.settings_accept($1,'Pessoa convidada',$2) value",
      [code, key],
    )
  ).rows[0].value;
}
async function joined() {
  const i = await invite();
  await asUser(guest);
  const member = await accept(i.code);
  await asUser(owner);
  return { i, member };
}

describe("Configurações009 SQL real/PGlite; Auth explicitamente simulado", () => {
  beforeAll(async () => {
    db = new PGlite();
    for (const file of [
      "tests/bootstrap.sql",
      "migrations/202609070001_foundation.sql",
      "migrations/202609080001_tenant_key_guards.sql",
      "migrations/202610120001_settings.sql",
    ])
      await db.exec(
        readFileSync(new URL("../supabase/" + file, import.meta.url), "utf8"),
      );
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,'owner@example.test',now()),($2,'guest@example.test',now()),($3,'other@example.test',now())",
      [owner, guest, other],
    );
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.exec("begin");
    await asUser(owner);
    const b = await onboard();
    org = b.organizationId;
    store = b.storeId;
    ownerMember = (await read()).members[0].id;
  });
  afterEach(async () => {
    await db.exec("rollback;reset role");
  });

  it("bootstrap creates scoped owner/grant/profile once and replays only identical input", async () => {
    const key = randomUUID();
    const b = await onboard(key, "Segunda empresa");
    expect(await onboard(key, "Segunda empresa")).toEqual(b);
    await denied(() => onboard(key, "Outra empresa"), "PT409");
    expect((await read(b.organizationId, b.storeId)).members[0]).toMatchObject({
      userId: owner,
      role: "owner",
      storeIds: [b.storeId],
    });
    await admin(
      "update public.memberships set active=false where organization_id=$1",
      [b.organizationId],
    );
    await denied(() => onboard(key, "Segunda empresa"), "42501");
  });
  it("bootstrap requires current verified nonanonymous identity", async () => {
    await admin("update auth.users set email_confirmed_at=null where id=$1", [
      owner,
    ]);
    await denied(() => onboard(), "42501");
    await admin(
      "update auth.users set email_confirmed_at=now(),is_anonymous=true where id=$1",
      [owner],
    );
    await denied(() => onboard(), "42501");
  });
  it("bootstrap bounds organizations per identity without granting existing tenants", async () => {
    for (let i = 0; i < 4; i++) await onboard();
    await denied(() => onboard(), "22023");
    await asUser(guest);
    await denied(() => read(), "42501");
  });
  it("denies cross-tenant/control-store, private reads and direct DML", async () => {
    await asUser(other);
    const b = await onboard();
    await denied(() => read(org, store), "42501");
    await asUser(owner);
    await denied(() => read(org, b.storeId), "42501");
    await denied(
      () => db.query("update public.memberships set role='owner'"),
      "42501",
    );
    await denied(
      () => db.query("select * from private.settings_invitations"),
      "42501",
    );
    await db.exec("set role anon");
    await denied(
      () => db.query("select public.settings_read($1,$2)", [org, store]),
      "42501",
    );
  });
  it("creates a store with explicit grant and replay without duplicate audit", async () => {
    const key = randomUUID(),
      payload = { name: " Segunda loja " };
    const a = await mutate("create_store", payload, key);
    const before = await read();
    expect(await mutate("create_store", { name: "Segunda loja" }, key)).toEqual(
      a,
    );
    expect((await read()).stores).toHaveLength(2);
    expect(before.members[0].storeIds).toContain(a.id);
    await denied(
      () => mutate("create_store", { name: "Diferente" }, key),
      "PT409",
    );
  });
  it("renames organization with CAS and rejects stale revision", async () => {
    await mutate("rename_organization", {
      name: "Empresa renomeada",
      revision: "1",
    });
    await denied(
      () =>
        mutate("rename_organization", { name: "Sobrescrever", revision: "1" }),
      "PT409",
    );
    expect((await read()).organization.revision).toBe("2");
  });
  it("protects own membership and the owner's final active store", async () => {
    await denied(
      () =>
        mutate("update_member", {
          id: ownerMember,
          role: "cashier",
          active: false,
          storeIds: [],
          revision: "1",
        }),
      "42501",
    );
    await denied(
      () =>
        mutate("update_store", {
          id: store,
          name: "Loja",
          active: false,
          revision: "1",
        }),
      "PT409",
    );
    expect((await read()).stores[0].active).toBe(true);
  });
  it("can inactivate current store when another active grant remains; old control store loses authority", async () => {
    const second = await mutate("create_store", { name: "Segunda" });
    await mutate("update_store", {
      id: store,
      name: "Primeira",
      active: false,
      revision: "1",
    });
    await denied(() => read(), "42501");
    expect(
      (await read(org, second.id)).stores.find((s) => s.id === store)?.active,
    ).toBe(false);
  });
  it("accepts matching verified email with exact stores and no extra authority", async () => {
    const second = await mutate("create_store", { name: "Segunda" }),
      i = await invite("cashier", [second.id]);
    await asUser(guest);
    const m = await accept(i.code);
    expect(m.storeId).toBe(second.id);
    await denied(() => read(org, second.id), "42501");
    await asUser(owner);
    expect(
      (await read()).members.find((x) => x.userId === guest),
    ).toMatchObject({ role: "cashier", storeIds: [second.id] });
  });
  it("never saves raw invitation code or email in invitation audit; read DTO has neither hash nor code", async () => {
    const i = await invite();
    const data = await read();
    expect(JSON.stringify(data)).not.toContain(i.code);
    expect(JSON.stringify(data)).not.toContain("code_hash");
    const rows = await admin(
      "select request from private.settings_attempts where actor_id=$1",
      [owner],
    );
    expect(JSON.stringify(rows.rows)).not.toContain(i.code);
    const audit = await admin(
      "select * from public.audit_events where entity_type='settings_invitations'",
    );
    expect(JSON.stringify(audit.rows)).not.toContain(i.code);
    expect(JSON.stringify(audit.rows)).not.toContain("guest@example.test");
  });
  it("rejects wrong email, changed email, unconfirmed and anonymous identities before revealing invite", async () => {
    const i = await invite();
    await asUser(other);
    await denied(() => accept(i.code), "42501");
    await admin(
      "update auth.users set email='changed@example.test' where id=$1",
      [guest],
    );
    await asUser(guest);
    await denied(() => accept(i.code), "42501");
    await admin(
      "update auth.users set email='guest@example.test',email_confirmed_at=null where id=$1",
      [guest],
    );
    await asUser(guest);
    await denied(() => accept(i.code), "42501");
    await admin(
      "update auth.users set email_confirmed_at=now(),is_anonymous=true where id=$1",
      [guest],
    );
    await asUser(guest);
    await denied(() => accept(i.code), "42501");
  });
  it("revoked and expired invitation cannot grant membership", async () => {
    const i = await invite();
    await mutate("revoke_invite", { id: i.id, revision: i.revision });
    await asUser(guest);
    await denied(() => accept(i.code), "42501");
    await asUser(owner);
    const expired = await invite();
    await admin(
      "update private.settings_invitations set expires_at=now()-interval '1 second' where id=$1",
      [expired.id],
    );
    await asUser(guest);
    await denied(() => accept(expired.code), "42501");
  });
  it("issuer loses authority before invitation acceptance", async () => {
    const i = await invite();
    await admin("update public.memberships set role='manager' where id=$1", [
      ownerMember,
    ]);
    await asUser(guest);
    await denied(() => accept(i.code), "42501");
  });
  it("inactivated invited store prevents acceptance but original create replay survives", async () => {
    const second = await mutate("create_store", { name: "Segunda" });
    const i = await invite("cashier", [second.id]);
    await mutate("update_store", {
      id: second.id,
      name: "Segunda",
      active: false,
      revision: "1",
    });
    expect(
      await mutate(
        "invite",
        {
          email: "guest@example.test",
          role: "cashier",
          storeIds: [second.id],
          code: i.code,
        },
        i.key,
      ),
    ).toMatchObject({ id: i.id });
    await asUser(guest);
    await denied(() => accept(i.code), "42501");
  });
  it("accept replay is identical and cannot recreate revoked grants", async () => {
    const i = await invite(),
      key = randomUUID();
    await asUser(guest);
    const a = await accept(i.code, key);
    expect(await accept(i.code, key)).toEqual(a);
    await denied(() => accept(i.code), "PT409");
    await asUser(owner);
    await mutate("update_member", {
      id: a.id,
      role: "cashier",
      active: false,
      storeIds: [],
      revision: "1",
    });
    await asUser(guest);
    await denied(() => accept(i.code, key), "42501");
  });
  it("existing inactive membership cannot be elevated/reactivated by a fresh invite", async () => {
    const { member } = await joined();
    await mutate("update_member", {
      id: member.id,
      role: "cashier",
      active: false,
      storeIds: [],
      revision: "1",
    });
    const i = await invite("owner");
    await asUser(guest);
    await denied(() => accept(i.code), "PT409");
    await asUser(owner);
    expect(
      (await read()).members.find((x) => x.id === member.id),
    ).toMatchObject({ active: false, role: "cashier" });
  });
  it("member CAS/replay and revocation before actor replay are enforced", async () => {
    const { member } = await joined();
    const key = randomUUID(),
      payload = {
        id: member.id,
        role: "manager",
        active: true,
        storeIds: [store],
        revision: "1",
      };
    const a = await mutate("update_member", payload, key);
    expect(await mutate("update_member", payload, key)).toEqual(a);
    await denied(
      () => mutate("update_member", { ...payload, role: "buyer" }),
      "PT409",
    );
    await admin("update public.memberships set active=false where id=$1", [
      ownerMember,
    ]);
    await denied(() => mutate("update_member", payload, key), "42501");
  });
  it("active member requires active same-tenant stores and role stays bounded", async () => {
    const { member } = await joined();
    await denied(
      () =>
        mutate("update_member", {
          id: member.id,
          role: "owner",
          active: true,
          storeIds: [],
          revision: "1",
        }),
      "22023",
    );
    await denied(
      () =>
        mutate("update_member", {
          id: member.id,
          role: "admin",
          active: true,
          storeIds: [store],
          revision: "1",
        }),
      "22023",
    );
    await asUser(other);
    const b = await onboard();
    await asUser(owner);
    await denied(
      () =>
        mutate("update_member", {
          id: member.id,
          role: "owner",
          active: true,
          storeIds: [b.storeId],
          revision: "1",
        }),
      "22023",
    );
  });
  it("protects all active owners from orphaning, not just the acting owner", async () => {
    const second = await mutate("create_store", { name: "Segunda" }),
      i = await invite("owner", [second.id]);
    await asUser(guest);
    await accept(i.code);
    await asUser(owner);
    await denied(
      () =>
        mutate("update_store", {
          id: second.id,
          name: "Segunda",
          active: false,
          revision: "1",
        }),
      "PT409",
    );
  });
  it("audit failure rolls back store/grant/ledger together", async () => {
    await db.exec("reset role");
    await db.exec(
      "create function private.settings_test_fail() returns trigger language plpgsql as $$begin raise exception 'fixture audit failure' using errcode='P0001'; end$$; create trigger settings_test_fail before insert on public.audit_events for each row execute function private.settings_test_fail()",
    );
    await asUser(owner);
    await denied(
      () => mutate("create_store", { name: "Não deve existir" }),
      "P0001",
    );
    expect((await read()).stores).toHaveLength(1);
  });
  it("rejects missing state, invalid names, extra fields and missing key", async () => {
    await denied(() => mutate("create_store", { name: "\n" }), "22023");
    await denied(
      () =>
        mutate("create_store", { name: "Loja", organizationId: randomUUID() }),
      "22023",
    );
    await denied(
      () => mutate("update_store", { id: store, name: "Loja", revision: "1" }),
      "22023",
    );
    await denied(
      () =>
        db.query(
          "select public.settings_onboard('Empresa','Loja','Pessoa',null)",
        ),
      "22023",
    );
  });
});
