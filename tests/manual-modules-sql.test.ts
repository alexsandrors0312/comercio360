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

describe("Pacotes 010–012: SQL local com Auth simulado", () => {
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
});
