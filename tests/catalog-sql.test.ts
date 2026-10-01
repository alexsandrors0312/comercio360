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

const sql = (path: string) =>
  readFileSync(new URL("../supabase/" + path, import.meta.url), "utf8");
let db: PGlite;
const orgA = "10000000-0000-4000-8000-000000000001";
const orgB = "20000000-0000-4000-8000-000000000001";
const storeA = "10000000-0000-4000-8000-000000000011";
const storeB = "20000000-0000-4000-8000-000000000011";
const managerA = "a0000000-0000-4000-8000-000000000001";
const cashierA = "c0000000-0000-4000-8000-000000000001";
async function asUser(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  await db.exec("set role authenticated");
}
async function category(name = "Blusas") {
  return (
    await db.query<{ id: string; revision: string }>(
      "select * from public.catalog_create_category($1,$2,$3)",
      [orgA, storeA, name],
    )
  ).rows[0];
}
async function product(
  categoryId: string | null,
  key = "aaaaaaaa-0000-4000-8000-000000000001",
) {
  return (
    await db.query<{ id: string; revision: string }>(
      "select * from public.catalog_create_product($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        orgA,
        storeA,
        "Camiseta",
        null,
        categoryId,
        "SKU-1",
        "Azul",
        "P",
        "001234",
        key,
      ],
    )
  ).rows[0];
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

describe("Catálogo 002 SQL", () => {
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
      create table storage.objects(id uuid primary key default gen_random_uuid(),
        bucket_id text not null,name text not null);
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated;
      grant select,insert on storage.objects to authenticated;
    `);
    await db.exec(sql("migrations/202609300002_catalog_storage.sql"));
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.exec("begin");
  });
  afterEach(async () => {
    await db.exec("rollback; reset role");
  });

  it("applies incrementally over H1 with RLS on each new table", async () => {
    const rows = (
      await db.query<{ relname: string; relrowsecurity: boolean }>(
        "select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname in ('product_categories','products','product_variants','product_prices','product_images','catalog_image_objects','catalog_create_requests')",
      )
    ).rows;
    expect(rows).toHaveLength(7);
    expect(rows.every((row) => row.relrowsecurity)).toBe(true);
  });

  it("requires role and live store grant for read/write, including catalog audit", async () => {
    await asUser(managerA);
    const cat = await category();
    const created = await product(cat.id);
    await asUser(cashierA);
    expect(
      (
        await db.query("select id from public.products where id=$1", [
          created.id,
        ])
      ).rows,
    ).toHaveLength(1);
    await denied(() => category("Negada"), "42501");
    await denied(
      () =>
        db.query("update public.products set name='Invasão' where id=$1", [
          created.id,
        ]),
      "42501",
    );
    await asUser(managerA);
    await denied(
      () =>
        db.query("select * from public.catalog_create_category($1,$2,$3)", [
          orgB,
          storeB,
          "Intrusa",
        ]),
      "42501",
    );
    await db.exec("reset role");
    await db.query(
      "update public.memberships set role='marketing' where user_id=$1",
      [managerA],
    );
    await asUser(managerA);
    expect(
      (
        await db.query("select id from public.products where id=$1", [
          created.id,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query(
          "select id from public.audit_events where entity_type='products' and entity_id=$1",
          [created.id],
        )
      ).rows,
    ).toHaveLength(0);
    await denied(() => category("Revogada"), "42501");
  });

  it("normalizes uniqueness, returns same idempotent result, and rejects stale CAS", async () => {
    await asUser(managerA);
    const cat = await category("  Blusas\u00a0 de\t verão  ");
    await denied(() => category("blusas de verão"), "23505");
    const first = await product(cat.id);
    const repeated = await product(cat.id);
    expect(repeated).toEqual(first);
    const updated = (
      await db.query<{ revision: string }>(
        "select * from public.catalog_update_product($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          orgA,
          storeA,
          first.id,
          first.revision,
          "Camiseta nova",
          null,
          cat.id,
          true,
        ],
      )
    ).rows[0];
    expect(Number(updated.revision)).toBe(Number(first.revision) + 1);
    expect(await product(cat.id)).toEqual(first);
    await denied(
      () =>
        db.query(
          "select * from public.catalog_update_product($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            orgA,
            storeA,
            first.id,
            first.revision,
            "Sobrescrita",
            null,
            cat.id,
            true,
          ],
        ),
      "40001",
    );
    await denied(
      () =>
        db.query(
          "select * from public.catalog_create_product($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            orgA,
            storeA,
            "Outro",
            null,
            cat.id,
            "SKU-2",
            null,
            null,
            null,
            "aaaaaaaa-0000-4000-8000-000000000001",
          ],
        ),
      "40001",
    );
  });

  it("isolates price by store, preserves decimals and rolls business writes back on audit failure", async () => {
    await asUser(managerA);
    const created = await product(null);
    const variant = (
      await db.query<{ id: string }>(
        "select id from public.product_variants where product_id=$1",
        [created.id],
      )
    ).rows[0];
    const price = (
      await db.query<{ id: string; revision: string }>(
        "select * from public.catalog_set_price($1,$2,$3,$4,$5)",
        [orgA, storeA, variant.id, null, "59,90"],
      )
    ).rows[0];
    expect(
      (
        await db.query<{ amount: string }>(
          "select amount from public.product_prices where id=$1",
          [price.id],
        )
      ).rows[0].amount,
    ).toBe("59.90");
    expect(
      (
        await db.query<{ store_id: string }>(
          "select store_id from public.audit_events where entity_type='product_prices' and entity_id=$1",
          [price.id],
        )
      ).rows[0].store_id,
    ).toBe(storeA);
    await denied(
      () =>
        db.query("select * from public.catalog_set_price($1,$2,$3,$4,$5)", [
          orgA,
          storeB,
          variant.id,
          null,
          "10.00",
        ]),
      "42501",
    );
    await denied(
      () =>
        db.query("select * from public.catalog_set_price($1,$2,$3,$4,$5)", [
          orgA,
          storeA,
          variant.id,
          price.revision,
          "10000000000.00",
        ]),
      "22023",
    );
    await db.exec("reset role");
    await db.exec(
      "alter table public.audit_events add constraint block_catalog_audit check(entity_type<>'product_categories')",
    );
    await asUser(managerA);
    await denied(() => category("Auditoria falha"), "23514");
    expect(
      (
        await db.query(
          "select id from public.product_categories where name='Auditoria falha'",
        )
      ).rows,
    ).toHaveLength(0);
  });

  it("rejects administrative cross-tenant relations and structural reassignment", async () => {
    await asUser(managerA);
    const cat = await category();
    const created = await product(cat.id);
    await db.exec("reset role");
    await denied(
      () =>
        db.query(
          "insert into public.products(organization_id,category_id,name) values($1,$2,'Cruzado')",
          [orgB, cat.id],
        ),
      "23514",
    );
    await denied(
      () =>
        db.query("update public.products set organization_id=$1 where id=$2", [
          orgB,
          created.id,
        ]),
      "23514",
    );
  });

  it("keeps existing products under an inactive category but rejects new associations", async () => {
    await asUser(managerA);
    const cat = await category();
    const existing = await product(cat.id);
    await db.query(
      "select * from public.catalog_update_category($1,$2,$3,$4,$5,$6)",
      [orgA, storeA, cat.id, cat.revision, "Blusas", false],
    );
    expect(
      (
        await db.query<{ category_id: string }>(
          "select category_id from public.products where id=$1",
          [existing.id],
        )
      ).rows[0].category_id,
    ).toBe(cat.id);
    await denied(
      () =>
        db.query(
          "select * from public.catalog_create_product($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            orgA,
            storeA,
            "Nova",
            null,
            cat.id,
            "SKU-NEW",
            null,
            null,
            null,
            "aaaaaaaa-0000-4000-8000-000000000099",
          ],
        ),
      "23514",
    );
  });

  it("reserves SKU, barcode and option combination after variant deactivation", async () => {
    await asUser(managerA);
    const created = await product(null);
    const first = (
      await db.query<{ id: string; revision: string }>(
        "select id,revision from public.product_variants where product_id=$1",
        [created.id],
      )
    ).rows[0];
    await db.query(
      "select * from public.catalog_update_variant($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        orgA,
        storeA,
        first.id,
        first.revision,
        "SKU-1",
        "Azul",
        "P",
        "001234",
        false,
      ],
    );
    await denied(
      () =>
        db.query(
          "select * from public.catalog_create_variant($1,$2,$3,$4,$5,$6,$7)",
          [orgA, storeA, created.id, " sku-1 ", "Verde", "P", null],
        ),
      "23505",
    );
    await denied(
      () =>
        db.query(
          "select * from public.catalog_create_variant($1,$2,$3,$4,$5,$6,$7)",
          [orgA, storeA, created.id, "SKU-2", "Verde", "P", "001234"],
        ),
      "23505",
    );
    await denied(
      () =>
        db.query(
          "select * from public.catalog_create_variant($1,$2,$3,$4,$5,$6,$7)",
          [orgA, storeA, created.id, "SKU-3", "azul", "p", null],
        ),
      "23505",
    );
  });

  it("paginates deterministically with a textual store price and blocks cross-tenant search", async () => {
    await asUser(managerA);
    const created = await product(null);
    const variant = (
      await db.query<{ id: string }>(
        "select id from public.product_variants where product_id=$1",
        [created.id],
      )
    ).rows[0];
    await db.query("select * from public.catalog_set_price($1,$2,$3,$4,$5)", [
      orgA,
      storeA,
      variant.id,
      null,
      "59.90",
    ]);
    await asUser(cashierA);
    const result = (
      await db.query<{
        product_id: string;
        price: string;
        total_count: number;
      }>("select * from public.catalog_search_products($1,$2,$3,$4,$5,$6,$7)", [
        orgA,
        storeA,
        "SKU-1",
        null,
        true,
        20,
        0,
      ])
    ).rows;
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      product_id: created.id,
      price: "59.90",
      total_count: 1,
    });
    await denied(
      () =>
        db.query(
          "select * from public.catalog_search_products($1,$2,$3,$4,$5,$6,$7)",
          [orgB, storeB, "", null, true, 20, 0],
        ),
      "42501",
    );
  });

  it("removes catalog and price visibility immediately after the last store grant is revoked", async () => {
    await asUser(managerA);
    const created = await product(null);
    const variant = (
      await db.query<{ id: string }>(
        "select id from public.product_variants where product_id=$1",
        [created.id],
      )
    ).rows[0];
    await db.query("select * from public.catalog_set_price($1,$2,$3,$4,$5)", [
      orgA,
      storeA,
      variant.id,
      null,
      "12.34",
    ]);
    await asUser(cashierA);
    expect(
      (
        await db.query("select id from public.products where id=$1", [
          created.id,
        ])
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          "select id from public.product_prices where variant_id=$1",
          [variant.id],
        )
      ).rows,
    ).toHaveLength(1);
    await db.exec("reset role");
    await db.query(
      "delete from public.user_store_access where membership_id=$1",
      ["c0000000-0000-4000-8000-000000000011"],
    );
    await asUser(cashierA);
    expect(
      (
        await db.query("select id from public.products where id=$1", [
          created.id,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query(
          "select id from public.product_prices where variant_id=$1",
          [variant.id],
        )
      ).rows,
    ).toHaveLength(0);
    await denied(
      () =>
        db.query(
          "select * from public.catalog_search_products($1,$2,$3,$4,$5,$6,$7)",
          [orgA, storeA, "", null, true, 20, 0],
        ),
      "42501",
    );
  });

  it("limits Storage to the owner's reserved object and blocks unvalidated cover activation", async () => {
    await asUser(managerA);
    const created = await product(null);
    const reservation = (
      await db.query<{ object_id: string; object_path: string }>(
        "select * from public.catalog_reserve_image($1,$2,$3)",
        [orgA, storeA, created.id],
      )
    ).rows[0];
    await db.query(
      "insert into storage.objects(bucket_id,name) values($1,$2)",
      ["catalog-private", reservation.object_path],
    );
    expect(
      (
        await db.query("select id from storage.objects where name=$1", [
          reservation.object_path,
        ])
      ).rows,
    ).toHaveLength(0);
    await denied(
      () =>
        db.query("insert into storage.objects(bucket_id,name) values($1,$2)", [
          "catalog-private",
          orgB + "/forged",
        ]),
      "42501",
    );
    await denied(
      () =>
        db.query(
          "select public.catalog_mark_image_uploaded($1,$2,$3,$4,$5,$6,$7)",
          [orgA, storeA, reservation.object_id, "image/png", 100, 10, 10],
        ),
      "42501",
    );
    await denied(
      () =>
        db.query("select * from public.catalog_set_cover($1,$2,$3,$4,$5)", [
          orgA,
          storeA,
          created.id,
          created.revision,
          reservation.object_id,
        ]),
      "23514",
    );
    await asUser(cashierA);
    expect(
      (
        await db.query("select id from storage.objects where name=$1", [
          reservation.object_path,
        ])
      ).rows,
    ).toHaveLength(0);
    await db.exec("reset role");
    expect(
      (
        await db.query(
          "select * from public.catalog_claim_image_cleanup(now()+interval '1 day',10)",
        )
      ).rows,
    ).toHaveLength(0);
  });

  it("atomically replaces a validated cover and retires the previous object", async () => {
    await asUser(managerA);
    const created = await product(null);
    const first = (
      await db.query<{ object_id: string; object_path: string }>(
        "select * from public.catalog_reserve_image($1,$2,$3)",
        [orgA, storeA, created.id],
      )
    ).rows[0];
    await db.query(
      "insert into storage.objects(bucket_id,name) values($1,$2)",
      ["catalog-private", first.object_path],
    );
    expect(
      (
        await db.query("select id from storage.objects where name=$1", [
          first.object_path,
        ])
      ).rows,
    ).toHaveLength(0);
    await db.exec("reset role");
    await db.query(
      "select public.catalog_mark_image_uploaded($1,$2,$3,$4,$5,$6,$7)",
      [orgA, storeA, first.object_id, "image/png", 100, 10, 10],
    );
    await asUser(managerA);
    const linked = (
      await db.query<{ revision: string }>(
        "select * from public.catalog_set_cover($1,$2,$3,$4,$5)",
        [orgA, storeA, created.id, created.revision, first.object_id],
      )
    ).rows[0];
    expect(
      (
        await db.query("select id from storage.objects where name=$1", [
          first.object_path,
        ])
      ).rows,
    ).toHaveLength(1);
    const second = (
      await db.query<{ object_id: string; object_path: string }>(
        "select * from public.catalog_reserve_image($1,$2,$3)",
        [orgA, storeA, created.id],
      )
    ).rows[0];
    await db.query(
      "insert into storage.objects(bucket_id,name) values($1,$2)",
      ["catalog-private", second.object_path],
    );
    await db.exec("reset role");
    await db.query(
      "select public.catalog_mark_image_uploaded($1,$2,$3,$4,$5,$6,$7)",
      [orgA, storeA, second.object_id, "image/webp", 200, 20, 20],
    );
    await asUser(managerA);
    await denied(
      () =>
        db.query("select * from public.catalog_set_cover($1,$2,$3,$4,$5)", [
          orgA,
          storeA,
          created.id,
          created.revision,
          second.object_id,
        ]),
      "40001",
    );
    await db.query("select * from public.catalog_set_cover($1,$2,$3,$4,$5)", [
      orgA,
      storeA,
      created.id,
      linked.revision,
      second.object_id,
    ]);
    expect(
      (
        await db.query<{ catalog_get_cover_path: string }>(
          "select public.catalog_get_cover_path($1,$2,$3)",
          [orgA, storeA, created.id],
        )
      ).rows[0].catalog_get_cover_path,
    ).toBe(second.object_path);
    expect(
      (
        await db.query("select id from storage.objects where name=$1", [
          first.object_path,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query("select id from storage.objects where name=$1", [
          second.object_path,
        ])
      ).rows,
    ).toHaveLength(1);
    await db.exec("reset role");
    expect(
      (
        await db.query<{ state: string }>(
          "select state from public.catalog_image_objects where id=$1",
          [first.object_id],
        )
      ).rows[0].state,
    ).toBe("cleanup_pending");
  });
  it("rejects a direct cover link after the product is deactivated", async () => {
    await asUser(managerA);
    const created = await product(null);
    const reserved = (
      await db.query<{ object_id: string }>(
        "select * from public.catalog_reserve_image($1,$2,$3)",
        [orgA, storeA, created.id],
      )
    ).rows[0];
    await db.exec("reset role");
    await db.query(
      "select public.catalog_mark_image_uploaded($1,$2,$3,$4,$5,$6,$7)",
      [orgA, storeA, reserved.object_id, "image/png", 100, 10, 10],
    );
    await asUser(managerA);
    const inactive = (
      await db.query<{ revision: string }>(
        "select * from public.catalog_update_product($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          orgA,
          storeA,
          created.id,
          created.revision,
          "Camiseta",
          null,
          null,
          false,
        ],
      )
    ).rows[0];
    await denied(
      () =>
        db.query("select * from public.catalog_set_cover($1,$2,$3,$4,$5)", [
          orgA,
          storeA,
          created.id,
          inactive.revision,
          reserved.object_id,
        ]),
      "23514",
    );
    expect(
      (
        await db.query(
          "select id from public.product_images where product_id=$1",
          [created.id],
        )
      ).rows,
    ).toHaveLength(0);
  });
});
