import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { signCatalogImageAttestation } from "../lib/catalog-image/attestation";

const sql = (path: string) =>
  readFileSync(new URL("../supabase/" + path, import.meta.url), "utf8");
const org = "10000000-0000-4000-8000-000000000001";
const store = "10000000-0000-4000-8000-000000000011";
const manager = "a0000000-0000-4000-8000-000000000001";
const cashier = "c0000000-0000-4000-8000-000000000001";
const key = Buffer.alloc(32, 0x0b);
let db: PGlite;

async function asUser(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}

describe("Catalog image attestation", () => {
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
      create table storage.buckets(
        id text primary key, name text not null, public boolean not null,
        file_size_limit integer, allowed_mime_types text[]
      );
      create table storage.objects(
        id uuid primary key default gen_random_uuid(),
        bucket_id text not null, name text not null
      );
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated;
      grant select,insert on storage.objects to authenticated;
    `);
    await db.exec(sql("migrations/202609300002_catalog_storage.sql"));
    await db.exec(sql("migrations/202609300003_catalog_image_attestation.sql"));
  });
  afterAll(async () => {
    await db?.close();
  });

  it("matches the standard HMAC-SHA256 output", async () => {
    const result = await db.query<{ mac: string }>(
      "select encode(private.catalog_hmac_sha256(convert_to($1,'UTF8'),decode($2,'hex')),'hex') as mac",
      ["Hi There", key.toString("hex")],
    );
    expect(result.rows[0].mac).toBe(
      createHmac("sha256", key).update("Hi There").digest("hex"),
    );
  });

  it("rejects forged, stale and unauthorized marks; accepts verified bytes once", async () => {
    await db.exec("begin");
    try {
      await db.exec("reset role");
      await db.query(
        "insert into private.catalog_image_attestation_key(secret) values(decode($1,'hex'))",
        [key.toString("hex")],
      );
      await asUser(manager);
      const product = (
        await db.query<{ id: string; revision: string }>(
          "select * from public.catalog_create_product($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            org,
            store,
            "Produto capa",
            null,
            null,
            "CAPA-1",
            null,
            null,
            null,
            "bbbbbbbb-0000-4000-8000-000000000001",
          ],
        )
      ).rows[0];
      const reserved = (
        await db.query<{ object_id: string; object_path: string }>(
          "select * from public.catalog_reserve_image($1,$2,$3)",
          [org, store, product.id],
        )
      ).rows[0];
      await db.query(
        "insert into storage.objects(bucket_id,name) values($1,$2)",
        ["catalog-private", reserved.object_path],
      );
      const bytes = Buffer.from("fixture processed image bytes");
      const sha256Hex = createHash("sha256").update(bytes).digest("hex");
      const now = Math.floor(Date.now() / 1000);
      const claim = {
        organizationId: org,
        storeId: store,
        productId: product.id,
        objectId: reserved.object_id,
        actorUserId: manager,
        mimeType: "image/png" as const,
        byteSize: bytes.length,
        width: 10,
        height: 10,
        sha256Hex,
        expiresUnix: now + 120,
      };
      const args = [
        org,
        store,
        reserved.object_id,
        claim.mimeType,
        claim.byteSize,
        claim.width,
        claim.height,
        sha256Hex,
        claim.expiresUnix,
      ];
      await db.exec("savepoint bad_mac");
      await expect(
        db.query(
          "select public.catalog_mark_image_attested($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [...args, "00".repeat(32)],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await db.exec("rollback to savepoint bad_mac; release savepoint bad_mac");

      await db.exec("savepoint expired");
      await expect(
        db.query(
          "select public.catalog_mark_image_attested($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            ...args.slice(0, 8),
            now - 1,
            signCatalogImageAttestation(claim, key),
          ],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await db.exec("rollback to savepoint expired; release savepoint expired");

      await asUser(cashier);
      await db.exec("savepoint cashier_mark");
      await expect(
        db.query(
          "select public.catalog_mark_image_attested($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [...args, signCatalogImageAttestation(claim, key)],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await db.exec(
        "rollback to savepoint cashier_mark; release savepoint cashier_mark",
      );

      await asUser(manager);
      const marked = await db.query<{ catalog_mark_image_attested: string }>(
        "select public.catalog_mark_image_attested($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [...args, signCatalogImageAttestation(claim, key)],
      );
      expect(marked.rows[0].catalog_mark_image_attested).toBe(
        reserved.object_id,
      );
      const linked = (
        await db.query<{ id: string; revision: string }>(
          "select * from public.catalog_set_cover($1,$2,$3,$4,$5)",
          [org, store, product.id, product.revision, reserved.object_id],
        )
      ).rows[0];
      expect(linked.id).toBe(product.id);
      await db.exec("savepoint replay");
      await expect(
        db.query(
          "select public.catalog_mark_image_attested($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [...args, signCatalogImageAttestation(claim, key)],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await db.exec("rollback to savepoint replay; release savepoint replay");
      const removed = (
        await db.query<{ revision: string }>(
          "select * from public.catalog_set_cover($1,$2,$3,$4,$5)",
          [org, store, product.id, linked.revision, null],
        )
      ).rows[0];
      expect(Number(removed.revision)).toBeGreaterThan(Number(linked.revision));
      expect(
        (
          await db.query(
            "select id from public.product_images where product_id=$1",
            [product.id],
          )
        ).rows,
      ).toHaveLength(0);
      await db.exec("reset role");
      expect(
        (
          await db.query<{ state: string }>(
            "select state from public.catalog_image_objects where id=$1",
            [reserved.object_id],
          )
        ).rows[0].state,
      ).toBe("cleanup_pending");
    } finally {
      await db.exec("rollback; reset role");
    }
  });
});
