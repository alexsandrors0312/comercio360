import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const sql = (path: string) => readFileSync(new URL("../supabase/" + path, import.meta.url), "utf8");
const org = "10000000-0000-4000-8000-000000000001";
const otherOrg = "20000000-0000-4000-8000-000000000001";
const store = "10000000-0000-4000-8000-000000000011";
const store2 = "10000000-0000-4000-8000-000000000012";
const otherStore = "20000000-0000-4000-8000-000000000011";
const manager = "a0000000-0000-4000-8000-000000000001";
const otherManager = "b0000000-0000-4000-8000-000000000001";
const cashier = "c0000000-0000-4000-8000-000000000001";
type Result = { id: string; revision: number; sale_id: string | null };
type Listing = Result & { status: string; channel: string; customer_id: string | null; customer_name_snapshot: string | null; total_count: number };
let db: PGlite;
let variant: string;

async function user(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  await db.exec("set role authenticated");
}
async function admin(query: string, values: unknown[] = []) {
  await db.exec("reset role");
  await db.query(query, values);
  await user(manager);
}
async function denied(action: () => Promise<unknown>, code: string) {
  await db.exec("savepoint expected_error");
  try { await expect(action()).rejects.toMatchObject({ code }); }
  finally { await db.exec("rollback to savepoint expected_error; release savepoint expected_error"); }
}
async function count(table: string) {
  return Number((await db.query<{ n: number }>(`select count(*) n from ${table}`)).rows[0].n);
}
function lines(price = 1234, quantity = 2) {
  return [{ variant_id: variant, quantity, expected_unit_price_cents: price }];
}
async function create(channel = "counter", customerId: string | null = null, key = randomUUID(), items = lines(), o = org, s = store) {
  const result = (await db.query<Result>("select * from public.orders_create($1,$2,$3,$4,$5,$6)",
    [o,s,channel,customerId,JSON.stringify(items),key])).rows[0];
  await db.exec("set constraints order_total,order_item_total immediate; set constraints order_total,order_item_total deferred");
  return result;
}
async function cancel(id: string, revision = 1, key = randomUUID(), reason = "Cancelamento fictício") {
  return (await db.query<Result>("select * from public.orders_cancel($1,$2,$3,$4,$5,$6)",
    [org,store,id,revision,reason,key])).rows[0];
}
async function fulfill(id: string, revision = 1, key = randomUUID()) {
  const result = (await db.query<Result>("select * from public.orders_fulfill($1,$2,$3,$4,$5)",
    [org,store,id,revision,key])).rows[0];
  await db.exec("set constraints order_total,order_item_total,sale_total,sale_item_total immediate; set constraints order_total,order_item_total,sale_total,sale_item_total deferred");
  return result;
}
async function list(o = org, s = store, status = "all", orderId: string | null = null) {
  return (await db.query<Listing>("select * from public.orders_list($1,$2,$3,20,0,$4)",
    [o,s,status,orderId])).rows;
}
async function customer(name = "Cliente Fictício", phone: string | null = "11999998888", o = org, s = store) {
  return (await db.query<{ id: string; revision: number }>("select * from public.customers_save($1,$2,null,null,$3,$4,null,true,$5)",
    [o,s,name,phone,randomUUID()])).rows[0];
}

describe("Pedidos 007 SQL real (PGlite; concurrency to be covered on hosted PostgreSQL)", () => {
  beforeAll(async () => {
    db = new PGlite();
    for (const file of ["tests/bootstrap.sql","migrations/202609070001_foundation.sql",
      "migrations/202609080001_tenant_key_guards.sql","seed.sql","tests/fixtures.sql",
      "migrations/202609300001_catalog.sql"]) await db.exec(sql(file));
    await db.exec("create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null,file_size_limit integer,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;");
    for (const file of ["202609300002_catalog_storage.sql","202609300003_catalog_image_attestation.sql",
      "202610020001_catalog_service_role_normalization.sql","202610030001_catalog_conflict_http.sql",
      "202610090001_inventory.sql","202610090002_procurement.sql","202610090003_sales.sql",
      "202610100001_customers.sql","202610100002_orders.sql"]) await db.exec(sql("migrations/" + file));
  });
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec("begin");
    await user(manager);
    const product = (await db.query<{ id: string }>("select * from public.catalog_create_product($1,$2,'Produto Pedido',null,null,'ORD-001',null,null,null,$3)",
      [org,store,randomUUID()])).rows[0];
    variant = (await db.query<{ id: string }>("select id from public.product_variants where product_id=$1",[product.id])).rows[0].id;
    await db.query("select * from public.catalog_set_price($1,$2,$3,$4,$5)",[org,store,variant,null,"12.34"]);
    await db.query("select * from public.inventory_move($1,$2,$3,'entry',10,'Estoque fictício',0,$4)",
      [org,store,variant,randomUUID()]);
  });
  afterEach(async () => { await db.exec("rollback;reset role"); });

  it("captures immutable snapshots without moving stock, then creates one matching sale", async () => {
    const c = await customer("Nome Original");
    const beforeStock = (await db.query<{ quantity: number }>("select quantity from public.inventory_balances where variant_id=$1",[variant])).rows[0].quantity;
    const beforeMoves = await count("public.inventory_movements");
    const order = await create("whatsapp",c.id);
    expect(order).toMatchObject({ revision: 1, sale_id: null });
    expect(await count("public.inventory_movements")).toBe(beforeMoves);
    expect((await list())[0]).toMatchObject({id:order.id,channel:"whatsapp",status:"open",customer_id:c.id,
      customer_name_snapshot:"Nome Original",total_count:1});
    expect((await db.query("select * from public.orders_items($1,$2,$3)",[org,store,order.id])).rows)
      .toMatchObject([{variant_id:variant,product_name:"Produto Pedido",sku:"ORD-001",quantity:2,unit_price_cents:1234}]);
    const done = await fulfill(order.id);
    expect(done).toMatchObject({ id: order.id, revision: 2 });
    expect(done.sale_id).toBeTruthy();
    expect((await list(org,store,"fulfilled",order.id))[0].sale_id).toBe(done.sale_id);
    expect((await db.query("select quantity from public.inventory_balances where variant_id=$1",[variant])).rows[0])
      .toMatchObject({quantity:beforeStock-2});
    expect((await db.query("select customer_name_snapshot from public.sales where id=$1",[done.sale_id])).rows[0])
      .toMatchObject({customer_name_snapshot:"Nome Original"});
    await db.query("select * from public.customers_save($1,$2,$3,1,'Nome Posterior','11999998888',null,true,$4)",
      [org,store,c.id,randomUUID()]);
    expect((await list(org,store,"all",order.id))[0].customer_name_snapshot).toBe("Nome Original");
  });
  it("requires a phone for WhatsApp, active customer, valid lines and store price", async () => {
    const noPhone = await customer("Sem Telefone",null);
    await denied(() => create("whatsapp",noPhone.id),"22023");
    await denied(() => create("whatsapp"),"22023");
    await denied(() => create("bogus"),"22023");
    await denied(() => create("counter",null,randomUUID(),lines(1235)),"PT409");
    await denied(() => create("counter",null,randomUUID(),[...lines(),...lines()]),"22023");
    await denied(() => create("counter",null,randomUUID(),[]),"22023");
    const c = await customer();
    await db.query("select * from public.customers_save($1,$2,$3,1,'Cliente Fictício','11999998888',null,false,$4)",
      [org,store,c.id,randomUUID()]);
    await denied(() => create("counter",c.id),"22023");
    expect(await count("public.orders")).toBe(0);
  });
  it("fulfillment keeps order open when price changes or stock is exhausted", async () => {
    const order = await create();
    const sales = await count("public.sales"), moves = await count("public.inventory_movements"), audits = await count("public.audit_events");
    await db.query("select * from public.catalog_set_price($1,$2,$3,1,'12.35')",[org,store,variant]);
    const changedAudits = await count("public.audit_events");
    await denied(() => fulfill(order.id),"PT409");
    expect((await list(org,store,"all",order.id))[0]).toMatchObject({status:"open",revision:1,sale_id:null});
    expect(await count("public.sales")).toBe(sales);
    expect(await count("public.inventory_movements")).toBe(moves);
    expect(await count("public.audit_events")).toBe(changedAudits);
    await db.query("select * from public.catalog_set_price($1,$2,$3,2,'12.34')",[org,store,variant]);
    await db.query("select * from public.inventory_move($1,$2,$3,'exit',10,'Esgotar fictício',1,$4)",
      [org,store,variant,randomUUID()]);
    const exhaustedAudits = await count("public.audit_events"), exhaustedMoves = await count("public.inventory_movements");
    await denied(() => fulfill(order.id),"PT422");
    expect((await list(org,store,"all",order.id))[0].status).toBe("open");
    expect(await count("public.sales")).toBe(sales);
    expect(await count("public.inventory_movements")).toBe(exhaustedMoves);
    expect(await count("public.audit_events")).toBe(exhaustedAudits);
    expect(audits).toBeLessThan(changedAudits);
  });
  it("keeps WhatsApp capture valid after phone removal but rejects an inactive customer", async () => {
    const c = await customer("Contato Original");
    const order = await create("whatsapp",c.id);
    await db.query("select * from public.customers_save($1,$2,$3,1,'Contato Alterado',null,null,true,$4)",
      [org,store,c.id,randomUUID()]);
    const fulfilled = await fulfill(order.id);
    expect(fulfilled.sale_id).toBeTruthy();
    expect((await list(org,store,"all",order.id))[0]).toMatchObject({status:"fulfilled",customer_name_snapshot:"Contato Original"});
    await db.query("select * from public.customers_save($1,$2,$3,2,'Contato Alterado','11999998888',null,true,$4)",
      [org,store,c.id,randomUUID()]);
    const second = await create("whatsapp",c.id);
    await db.query("select * from public.customers_save($1,$2,$3,3,'Contato Alterado','11999998888',null,false,$4)",
      [org,store,c.id,randomUUID()]);
    await denied(() => fulfill(second.id),"22023");
    expect((await list(org,store,"all",second.id))[0].status).toBe("open");
    expect(await count("public.sales")).toBe(1);
  });
  it("replays exact attempts and conflicts different payload, key, revision or terminal status", async () => {
    const createKey = randomUUID();
    const first = await create("counter",null,createKey);
    expect(await create("counter",null,createKey)).toEqual(first);
    await denied(() => create("counter",null,createKey,lines(1234,3)),"PT409");
    const fulfillKey = randomUUID(), done = await fulfill(first.id,1,fulfillKey);
    expect(await fulfill(first.id,1,fulfillKey)).toEqual(done);
    await denied(() => fulfill(first.id,1,randomUUID()),"PT409");
    const second = await create();
    await denied(() => fulfill(second.id,1,fulfillKey),"PT409");
    await denied(() => cancel(first.id),"PT409");
    const cancelKey = randomUUID(), cancelled = await cancel(second.id,1,cancelKey);
    expect(cancelled).toMatchObject({id:second.id,revision:2,sale_id:null});
    expect(await cancel(second.id,1,cancelKey)).toEqual(cancelled);
    await denied(() => cancel(second.id,1,cancelKey,"Outro motivo"),"PT409");
    await denied(() => fulfill(second.id),"PT409");
    await denied(() => cancel(second.id),"PT409");
  });
  it("enforces roles, active grant, selected store and tenant on reads, writes and replay", async () => {
    await user(cashier);
    const order = await create();
    expect(await list()).toHaveLength(1);
    await denied(() => cancel(order.id),"42501");
    const key = randomUUID();
    const done = await fulfill(order.id,1,key);
    await user(otherManager);
    expect((await db.query("select id from public.orders where id=$1",[order.id])).rows).toHaveLength(0);
    await denied(() => list(org,store),"42501");
    await denied(() => create("counter",null,randomUUID(),lines(),org,store),"42501");
    await denied(() => db.query("select * from public.orders_items($1,$2,$3)",[otherOrg,otherStore,order.id]),"42501");
    await user(cashier);
    for (const target of ["role","grant","membership","store"]) {
      await admin(target==="role" ? "update public.memberships set role='buyer' where user_id=$1" :
        target==="grant" ? "delete from public.user_store_access where organization_id=$1 and store_id=$2 and membership_id=(select id from public.memberships where user_id=$3)" :
        target==="membership" ? "update public.memberships set active=false where user_id=$1" :
        "update public.stores set active=false where id=$1",
        target==="grant" ? [org,store,cashier] : [target==="store" ? store : cashier]);
      await user(cashier);
      await denied(() => fulfill(order.id,1,key),"42501");
      await denied(() => list(),"42501");
      await db.exec("reset role");
      if (target==="role") await db.query("update public.memberships set role='cashier' where user_id=$1",[cashier]);
      if (target==="membership") await db.query("update public.memberships set active=true where user_id=$1",[cashier]);
      if (target==="store") await db.query("update public.stores set active=true where id=$1",[store]);
      if (target==="grant") await db.query("insert into public.user_store_access(organization_id,membership_id,store_id) select $1,id,$2 from public.memberships where user_id=$3",[org,store,cashier]);
      await user(cashier);
    }
    expect(await fulfill(order.id,1,key)).toEqual(done);
    await denied(() => db.query("select * from public.orders_items($1,$2,$3)",[org,store2,order.id]),"42501");
  });
  it("blocks direct DML, structural mutation and rolls back an audit failure", async () => {
    const order = await create();
    await denied(() => db.query("update public.orders set status='cancelled' where id=$1",[order.id]),"42501");
    await denied(() => db.query("delete from public.orders where id=$1",[order.id]),"42501");
    await denied(() => db.query("insert into public.order_items(organization_id,store_id,order_id,variant_id,product_name,sku,quantity,unit_price_cents) values($1,$2,$3,$4,'X','X',1,1234)",[org,store,order.id,variant]),"42501");
    await db.exec("reset role");
    await denied(() => db.query("update public.orders set organization_id=$1 where id=$2",[otherOrg,order.id]),"23514");
    await db.exec("create function private.reject_order_test_audit() returns trigger language plpgsql as $$begin if new.entity_type='orders' and new.action='update' then raise exception 'Injected order audit failure' using errcode='23514'; end if; return new; end;$$;create trigger injected_order_audit before insert on public.audit_events for each row execute function private.reject_order_test_audit();");
    await user(manager);
    const before = await count("public.audit_events");
    const beforeMoves = await count("public.inventory_movements");
    await denied(() => cancel(order.id),"23514");
    await denied(() => fulfill(order.id),"23514");
    expect((await list(org,store,"all",order.id))[0]).toMatchObject({status:"open",revision:1});
    expect(await count("public.audit_events")).toBe(before);
    expect(await count("public.sales")).toBe(0);
    expect(await count("public.inventory_movements")).toBe(beforeMoves);
    await db.exec("reset role");
    expect(await count("private.orders_requests")).toBe(1);
    await user(manager);
  });
  it("preserves legacy sales confirmation and order fulfillment after sale cancellation", async () => {
    const key = randomUUID();
    const legacy = (await db.query<{id:string;revision:number}>("select * from public.sales_confirm($1,$2,$3,$4)",
      [org,store,JSON.stringify(lines(1234,1)),key])).rows[0];
    expect(legacy.revision).toBe(1);
    await db.exec("set constraints sale_total,sale_item_total immediate; set constraints sale_total,sale_item_total deferred");
    const order = await create();
    const done = await fulfill(order.id);
    await db.query("select * from public.sales_cancel($1,$2,$3,1,'Devolução integral',$4)",
      [org,store,done.sale_id,randomUUID()]);
    expect((await list(org,store,"all",order.id))[0]).toMatchObject({status:"fulfilled",sale_id:done.sale_id});
    await denied(() => fulfill(order.id),"PT409");
  });
  it("never attaches a pre-existing direct sale when its attempt key is reused for fulfillment", async () => {
    const sharedKey = randomUUID();
    const direct = (await db.query<{id:string}>("select * from public.sales_confirm($1,$2,$3,$4)",
      [org,store,JSON.stringify(lines()),sharedKey])).rows[0];
    await db.exec("set constraints sale_total,sale_item_total immediate; set constraints sale_total,sale_item_total deferred");
    const order = await create();
    const fulfilled = await fulfill(order.id,1,sharedKey);
    expect(fulfilled.sale_id).not.toBe(direct.id);
    expect(await fulfill(order.id,1,sharedKey)).toEqual(fulfilled);
    expect(await count("public.sales")).toBe(2);
  });
});
