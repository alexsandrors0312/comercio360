import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const org = "10000000-0000-4000-8000-000000000001";
const store = "10000000-0000-4000-8000-000000000011";
const otherStore = "10000000-0000-4000-8000-000000000012";
const manager = "a0000000-0000-4000-8000-000000000001";
const cashier = "c0000000-0000-4000-8000-000000000001";
const sql = (path: string) => readFileSync(new URL("../supabase/" + path, import.meta.url), "utf8");
let db: PGlite;
let variant: string;

async function user(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  await db.exec("set role authenticated");
}
async function denied(call: () => Promise<unknown>, code: string) {
  await db.exec("savepoint expected_error");
  try { await expect(call()).rejects.toMatchObject({ code }); }
  finally { await db.exec("rollback to savepoint expected_error; release savepoint expected_error"); }
}
async function sale() {
  return (await db.query<{ id: string }>(
    "select * from public.sales_confirm($1,$2,$3,$4)",
    [org, store, JSON.stringify([{ variant_id: variant, quantity: 1, expected_unit_price_cents: 1000 }]), randomUUID()],
  )).rows[0].id;
}
async function command(rpc: string, args: unknown[]) {
  return (await db.query<{ result: { id: string; status: string; revision: string } }>(
    `select public.${rpc}(${args.map((_, i) => `$${i + 1}`).join(",")}) result`, args,
  )).rows[0].result;
}

describe("Pacotes 010–013: SQL local com Auth simulado", () => {
  beforeAll(async () => {
    db = new PGlite();
    for (const file of [
      "tests/bootstrap.sql", "migrations/202609070001_foundation.sql",
      "migrations/202609080001_tenant_key_guards.sql", "seed.sql", "tests/fixtures.sql",
      "migrations/202609300001_catalog.sql",
    ]) await db.exec(sql(file));
    await db.exec("create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null,file_size_limit integer,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;");
    for (const file of [
      "202609300002_catalog_storage.sql", "202609300003_catalog_image_attestation.sql",
      "202610020001_catalog_service_role_normalization.sql", "202610030001_catalog_conflict_http.sql",
      "202610090001_inventory.sql", "202610090002_procurement.sql", "202610090003_sales.sql",
      "202610100001_customers.sql", "202610100002_orders.sql", "202610120001_settings.sql",
      "20261022205548_finance_manual.sql", "20261022205557_deliveries_manual.sql",
      "20261022205611_marketing_calendar.sql",
      "20261026164724_marketing_rich.sql",
    ]) await db.exec(sql("migrations/" + file));
  });
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec("begin");
    await user(manager);
    const product = (await db.query<{ id: string }>(
      "select * from public.catalog_create_product($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [org, store, "Produto fictício", null, null, "SKU-MANUAL", "Azul", "M", "BAR-MANUAL", randomUUID()],
    )).rows[0];
    variant = (await db.query<{ id: string }>("select id from public.product_variants where product_id=$1", [product.id])).rows[0].id;
    await db.query("select * from public.catalog_set_price($1,$2,$3,$4,$5)", [org, store, variant, null, "10.00"]);
    await db.query("select * from public.inventory_move($1,$2,$3,'entry',3,'Estoque fictício',0,$4)", [org, store, variant, randomUUID()]);
  });
  afterEach(async () => { await db.exec("rollback;reset role"); });

  it("registra recebimento parcial, impede excesso e mantém reenvio idempotente", async () => {
    const id = await sale();
    const key = randomUUID();
    const args = [org, store, id, 600, "cash", "Teste", key];
    const first = await command("finance_record", args);
    expect(await command("finance_record", args)).toEqual(first);
    await denied(() => command("finance_record", [org, store, id, 500, "pix", "", randomUUID()]), "PT409");
    const read = await command("finance_read", [org, store]) as unknown as { cashBalanceCents: string; sales: { receivedCents: string }[] };
    expect(read.cashBalanceCents).toBe("600");
    expect(read.sales[0].receivedCents).toBe("600");
    await command("finance_cash", [org, store, "out", 100, "Troco fictício", randomUUID()]);
    await denied(() => command("finance_reverse", [org, store, first.id, "Estorno fictício", randomUUID()]), "PT409");
  });

  it("reverte com motivo, preserva saldo e limita o papel de caixa", async () => {
    const id = await sale();
    const first = await command("finance_record", [org, store, id, 400, "cash", "Fictício", randomUUID()]);
    const key = randomUUID();
    const args = [org, store, first.id, "Registro de teste", key];
    const reversed = await command("finance_reverse", args);
    expect((await command("finance_reverse", args)).id).toBe(reversed.id);
    await denied(() => command("finance_reverse", [org, store, first.id, "Outro motivo", key]), "PT409");
    const read = await command("finance_read", [org, store]) as unknown as { cashBalanceCents: string; receipts: { status: string }[] };
    expect(read.cashBalanceCents).toBe("0");
    expect(read.receipts[0].status).toBe("reversed");
    await user(cashier);
    await denied(() => command("finance_cash", [org, store, "in", 100, "Teste fictício", randomUUID()]), "42501");
    await denied(() => command("finance_reverse", [org, store, first.id, "Teste fictício", randomUUID()]), "42501");
  });

  it("vincula entrega à venda, controla revisão e isola loja", async () => {
    const id = await sale();
    const first = await command("deliveries_mutate", [org, store, "create",
      JSON.stringify({ saleId: id, mode: "pickup", assignedLabel: "Equipe A" }), randomUUID()]);
    expect(first.status).toBe("queued");
    await denied(() => command("deliveries_mutate", [org, otherStore, "transition",
      JSON.stringify({ id: first.id, revision: "1", status: "ready" }), randomUUID()]), "PT409");
    const ready = await command("deliveries_mutate", [org, store, "transition",
      JSON.stringify({ id: first.id, revision: "1", status: "ready" }), randomUUID()]);
    expect(ready.revision).toBe("2");
    await denied(() => command("deliveries_mutate", [org, store, "transition",
      JSON.stringify({ id: first.id, revision: "1", status: "completed" }), randomUUID()]), "PT409");
    await denied(() => command("deliveries_mutate", [org, store, "transition",
      JSON.stringify({ id: first.id, revision: "2", status: "out_for_delivery" }), randomUUID()]), "PT409");
    await denied(() => command("deliveries_mutate", [org, store, "create",
      JSON.stringify({ saleId: id, mode: "pickup", assignedLabel: "Equipe B" }), randomUUID()]), "PT409");
  });

  it("planeja campanha sem envio e nega perfil sem permissão", async () => {
    const first = await command("marketing_mutate", [org, store, "create",
      JSON.stringify({ title: "Campanha fictícia", channel: "store", plannedAt: "2026-11-01T12:00:00Z" }), randomUUID()]);
    expect(first.status).toBe("draft");
    await user(cashier);
    await denied(() => command("marketing_read", [org, store]), "42501");
    await user(manager);
    const scheduled = await command("marketing_mutate", [org, store, "transition",
      JSON.stringify({ id: first.id, revision: "1", status: "scheduled" }), randomUUID()]);
    expect(scheduled.status).toBe("scheduled");
    await denied(() => command("marketing_mutate", [org, store, "update",
      JSON.stringify({ id: first.id, revision: "1", title: "Campanha antiga", channel: "store", plannedAt: "2026-11-02T12:00:00Z" }), randomUUID()]), "PT409");
    const done = await command("marketing_mutate", [org, store, "transition",
      JSON.stringify({ id: first.id, revision: "2", status: "completed" }), randomUUID()]);
    expect(done.status).toBe("completed");
    await denied(() => command("marketing_mutate", [org, store, "update",
      JSON.stringify({ id: first.id, revision: "3", title: "Campanha alterada", channel: "store", plannedAt: "2026-11-02T12:00:00Z" }), randomUUID()]), "PT409");
  });

  it("salva conteúdo e variantes com replay, revisão e estado terminal", async () => {
    const created = await command("marketing_mutate", [org, store, "create",
      JSON.stringify({ title: "Vitrine fictícia", channel: "instagram", plannedAt: "2026-11-01T12:00:00Z" }), randomUUID()]);
    const key = randomUUID();
    const args = [org, store, created.id, 1, "promotion", "Conheça o produto da loja.", [variant], key];
    const saved = await command("marketing_rich_save", args);
    expect(saved).toEqual({ id: created.id, status: "draft", revision: "2" });
    expect(await command("marketing_rich_save", args)).toEqual(saved);
    const read = await command("marketing_rich_read", [org, store,
      "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"]) as unknown as {
      campaigns: { objective: string; contentBody: string; products: {
        variantId: string; priceCents: string; quantity: number; hasCover: boolean
      }[] }[]; hasMore: boolean;
    };
    expect(read.hasMore).toBe(false);
    expect(read.campaigns[0]).toMatchObject({ objective: "promotion", contentBody: "Conheça o produto da loja." });
    expect(read.campaigns[0].products).toMatchObject([
      { variantId: variant, priceCents: "1000", quantity: 3, hasCover: false },
    ]);
    const candidates = (await command("marketing_product_search", [org, store, "Produto", 20, 0])) as unknown as {
      items: { variantId: string; priceCents: string }[]; total: number
    };
    expect(candidates.total).toBe(1);
    expect(candidates.items[0]).toMatchObject({ variantId: variant, priceCents: "1000" });
    await denied(() => command("marketing_rich_save", [org, store, created.id, 2,
      "promotion", "Texto diferente", [variant], key]), "PT409");
    await denied(() => command("marketing_rich_save", [org, store, created.id, 1,
      "promotion", "Texto antigo", [variant], randomUUID()]), "PT409");
    await denied(() => command("marketing_rich_save", [org, store, created.id, 2,
      "promotion", "Outro texto", [variant, variant], randomUUID()]), "22023");
    await denied(() => command("marketing_rich_save", [org, store, created.id, 2,
      "promotion", "Outro texto", Array.from({ length: 7 }, () => randomUUID()), randomUUID()]), "22023");
    await denied(() => command("marketing_rich_save", [org, otherStore, created.id, 2,
      "promotion", "Outra loja", [variant], randomUUID()]), "PT409");
    await db.exec("reset role");
    await db.query("delete from public.product_prices where organization_id=$1 and store_id=$2 and variant_id=$3",
      [org, store, variant]);
    await user(manager);
    const afterPriceRemoval = await command("marketing_rich_read", [org, store,
      "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"]) as unknown as {
      campaigns: { products: { priceCents: string | null }[] }[]
    };
    expect(afterPriceRemoval.campaigns[0].products[0].priceCents).toBeNull();
    expect(await command("marketing_rich_save", args)).toEqual(saved);
    await denied(() => command("marketing_rich_save", [org, store, created.id, 2,
      "promotion", "Novo texto", [variant], randomUUID()]), "22023");
    const scheduled = await command("marketing_mutate", [org, store, "transition",
      JSON.stringify({ id: created.id, revision: "2", status: "scheduled" }), randomUUID()]);
    const completed = await command("marketing_mutate", [org, store, "transition",
      JSON.stringify({ id: created.id, revision: scheduled.revision, status: "completed" }), randomUUID()]);
    await denied(() => command("marketing_rich_save", [org, store, created.id, Number(completed.revision),
      "promotion", "Não pode mudar", [variant], randomUUID()]), "PT409");
    expect(await command("marketing_rich_save", args)).toEqual(saved);
    expect((await db.query<{ n: string }>("select count(*)::text as n from public.audit_events where entity_id=$1 and action='marketing.content'", [created.id])).rows[0].n).toBe("1");
  });

  it("nega variante inativa e fora da organização na primeira gravação", async () => {
    const created = await command("marketing_mutate", [org, store, "create",
      JSON.stringify({ title: "Vitrine fictícia", channel: "store", plannedAt: "2026-11-01T12:00:00Z" }), randomUUID()]);
    await db.exec("reset role");
    await db.query("update public.product_variants set active=false where organization_id=$1 and id=$2", [org, variant]);
    await user(manager);
    await denied(() => command("marketing_rich_save", [org, store, created.id, 1,
      "institutional", "Teste", [variant], randomUUID()]), "22023");
    await denied(() => command("marketing_rich_save", [org, store, created.id, 1,
      "institutional", "Teste", [randomUUID()], randomUUID()]), "22023");
  });

  it("invalida preço e capa de variante vinculada que ficou inativa", async () => {
    const created = await command("marketing_mutate", [org, store, "create",
      JSON.stringify({ title: "Vitrine fictícia", channel: "store", plannedAt: "2026-11-01T12:00:00Z" }), randomUUID()]);
    await command("marketing_rich_save", [org, store, created.id, 1,
      "institutional", "Teste", [variant], randomUUID()]);
    await db.exec("reset role");
    await db.query("update public.product_variants set active=false where organization_id=$1 and id=$2", [org, variant]);
    await user(manager);
    const read = await command("marketing_rich_read", [org, store,
      "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"]) as unknown as {
      campaigns: { products: { priceCents: string | null; hasCover: boolean }[] }[]
    };
    expect(read.campaigns[0].products[0]).toMatchObject({ priceCents: null, hasCover: false });
    const product = (await db.query<{ product_id: string }>(
      "select product_id from public.product_variants where id=$1", [variant])).rows[0].product_id;
    await db.exec("reset role");
    await db.query("update public.product_variants set active=true where organization_id=$1 and id=$2", [org, variant]);
    await db.query("update public.products set active=false where organization_id=$1 and id=$2", [org, product]);
    await user(manager);
    const inactiveProductRead = await command("marketing_rich_read", [org, store,
      "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"]) as unknown as {
      campaigns: { products: { priceCents: string | null; hasCover: boolean }[] }[]
    };
    expect(inactiveProductRead.campaigns[0].products[0]).toMatchObject({ priceCents: null, hasCover: false });
  });

  it("isola catálogo e capas por papel, loja e objeto ativo", async () => {
    const marketing = "e0000000-0000-4000-8000-000000000001";
    const membership = "e0000000-0000-4000-8000-000000000011";
    const product = (await db.query<{ product_id: string }>(
      "select product_id from public.product_variants where id=$1", [variant])).rows[0].product_id;
    const objectId = randomUUID();
    const path = `${org}/${product}/${objectId}`;
    await db.exec("reset role");
    await db.query("insert into auth.users(id) values($1)", [marketing]);
    await db.query("insert into public.profiles(id,display_name) values($1,'Marketing fictício')", [marketing]);
    await db.query("insert into public.memberships(id,organization_id,user_id,role) values($1,$2,$3,'marketing')",
      [membership, org, marketing]);
    await db.query("insert into public.user_store_access(organization_id,membership_id,store_id) values($1,$2,$3)",
      [org, membership, store]);
    await db.query("insert into public.catalog_image_objects(id,organization_id,product_id,actor_user_id,object_path,state) values($1,$2,$3,$4,$5,'active')",
      [objectId, org, product, manager, path]);
    await db.query("insert into public.product_images(organization_id,product_id,object_id) values($1,$2,$3)",
      [org, product, objectId]);
    await db.query("insert into storage.objects(bucket_id,name) values('catalog-private',$1)", [path]);
    await db.query("insert into storage.objects(bucket_id,name) values('catalog-private',$1)", [`${org}/${product}/${randomUUID()}`]);
    await user(marketing);
    const marketingProducts = (await command("marketing_product_search", [org, store, "", 20, 0])) as unknown as {
      items: { hasCover: boolean }[]
    };
    expect(marketingProducts.items[0].hasCover).toBe(true);
    expect((await command("marketing_cover_path", [org, store, product]) as unknown)).toBe(path);
    expect((await db.query<{ name: string }>("select name from storage.objects where bucket_id='catalog-private'")).rows)
      .toEqual([{ name: path }]);
    expect((await db.query("select id from public.product_prices")).rows).toHaveLength(0);
    await denied(() => command("marketing_product_search", [org, otherStore, "", 20, 0]), "42501");
    await denied(() => command("marketing_cover_path", ["20000000-0000-4000-8000-000000000001",
      "20000000-0000-4000-8000-000000000011", product]), "42501");
    await db.exec("reset role");
    await db.query("delete from public.product_prices where organization_id=$1 and store_id=$2 and variant_id=$3",
      [org, store, variant]);
    await user(marketing);
    expect(await command("marketing_cover_path", [org, store, product])).toBeNull();
    expect((await db.query("select name from storage.objects where bucket_id='catalog-private'")).rows).toHaveLength(0);
    await user(manager);
    await db.query("select * from public.catalog_set_price($1,$2,$3,$4,$5)", [org, store, variant, null, "10.00"]);
    await db.exec("reset role");
    await db.query("update public.products set active=false where organization_id=$1 and id=$2", [org, product]);
    await user(marketing);
    expect(await command("marketing_cover_path", [org, store, product])).toBeNull();
    expect((await db.query("select name from storage.objects where bucket_id='catalog-private'")).rows).toHaveLength(0);
    await user(cashier);
    await denied(() => command("marketing_rich_read", [org, store,
      "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"]), "42501");
    await db.exec("reset role");
    await db.query("delete from public.user_store_access where organization_id=$1 and membership_id=$2", [org, membership]);
    await user(marketing);
    await denied(() => command("marketing_product_search", [org, store, "", 20, 0]), "42501");
    expect((await db.query("select name from storage.objects where bucket_id='catalog-private'")).rows).toHaveLength(0);
  });
});
