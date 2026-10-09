// TEST ONLY: Supabase HTTP contract fixture, backed by the real migration in PGlite.
// Does not implement or prove Supabase's JWT signature/refresh/email infrastructure.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
for (const file of [
  "tests/bootstrap.sql",
  "migrations/202609070001_foundation.sql",
  "migrations/202609080001_tenant_key_guards.sql",
  "seed.sql",
  "tests/fixtures.sql",
  "tests/context-fixtures.sql",
  "migrations/202609300001_catalog.sql",
  "migrations/202610020001_catalog_service_role_normalization.sql",
  "migrations/202610030001_catalog_conflict_http.sql",
  "migrations/202610090001_inventory.sql",
  "migrations/202610090002_procurement.sql",
])
  await db.exec(
    readFileSync(new URL("../../supabase/" + file, import.meta.url), "utf8"),
  );
await db.exec(`
  insert into auth.users(id) values ('80000000-0000-4000-8000-000000000001'),('90000000-0000-4000-8000-000000000001');
  insert into public.profiles(id,display_name) values ('80000000-0000-4000-8000-000000000001','Estoquista fictício'),('90000000-0000-4000-8000-000000000001','Comprador fictício');
  insert into public.memberships(id,organization_id,user_id,role) values
    ('80000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','stockist'),
    ('90000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','buyer');
  insert into public.user_store_access(organization_id,membership_id,store_id) values
    ('10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000011'),
    ('10000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000011');
  insert into public.product_categories(id,organization_id,name) values
   ('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000001','Blusas');
  insert into public.products(id,organization_id,category_id,name,description) values
   ('10000000-0000-4000-8000-000000000201','10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000101','Camiseta básica','Produto fictício do navegador');
  insert into public.product_variants(id,organization_id,product_id,sku,color,size) values
   ('10000000-0000-4000-8000-000000000301','10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000201','CAM-AZ-P','Azul','P');
  insert into public.product_prices(organization_id,store_id,variant_id,amount) values
   ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000011',
    '10000000-0000-4000-8000-000000000301',59.90);
`);
const tokens = new Map();
const identities = {
  "gerente.aurora@example.test": "a",
  "gerente.horizonte@example.test": "b",
  "caixa.aurora@example.test": "c",
  "sem.vinculo@example.test": "d",
  "multiempresa@example.test": "e",
  "sem.loja@example.test": "f",
  "estoquista.aurora@example.test": "8",
  "comprador.aurora@example.test": "9",
};
let queue = Promise.resolve();
const reply = (response, status, data) => {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
};
createServer((request, response) => {
  queue = queue
    .then(async () => {
      try {
        const url = new URL(request.url, "http://127.0.0.1:54329");
        let raw = "";
        for await (const chunk of request) raw += chunk;
        const body = raw ? JSON.parse(raw) : {};
        if (url.pathname === "/health")
          return reply(response, 200, { ok: true });
        if (url.pathname === "/auth/v1/token") {
          const letter = identities[body.email];
          if (!letter || body.password !== "test-password-only")
            return reply(response, 400, {
              code: "invalid_credentials",
              msg: "Invalid login credentials",
            });
          const user = {
            id: `${letter}0000000-0000-4000-8000-000000000001`,
            email: body.email,
            aud: "authenticated",
            role: "authenticated",
            app_metadata: { provider: "email" },
            user_metadata: {},
            created_at: "2026-09-05T00:00:00Z",
          };
          const exp = Math.floor(Date.now() / 1000) + 3600;
          const token = [
            { alg: "HS256", typ: "JWT" },
            { sub: user.id, exp, role: "authenticated" },
            "fixture",
          ]
            .map((p) =>
              Buffer.from(
                typeof p === "string" ? p : JSON.stringify(p),
              ).toString("base64url"),
            )
            .join(".");
          tokens.set(token, user);
          return reply(response, 200, {
            access_token: token,
            refresh_token: "fixture-refresh",
            expires_in: 3600,
            expires_at: exp,
            token_type: "bearer",
            user,
          });
        }
        const token = request.headers.authorization?.replace(/^Bearer /, "");
        const user = tokens.get(token);
        if (url.pathname === "/auth/v1/user")
          return reply(
            response,
            user ? 200 : 401,
            user ?? { msg: "Invalid token" },
          );
        if (url.pathname === "/auth/v1/logout") {
          tokens.delete(token);
          return reply(response, 200, {});
        }
        if (!user) return reply(response, 401, { message: "Invalid token" });
        await db.exec("reset role");
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
          user.id,
        ]);
        await db.exec("set role authenticated");
        if (url.pathname === "/rest/v1/rpc/set_active_store") {
          await db.query("select public.set_active_store($1,$2)", [
            body.p_organization_id,
            body.p_store_id,
          ]);
          return reply(response, 200, null);
        }
        const catalogRpcArguments = {
          inventory_stock: [
            "p_organization_id",
            "p_store_id",
            "p_query",
            "p_limit",
            "p_offset",
            "p_variant_id",
          ],
          inventory_history: [
            "p_organization_id",
            "p_store_id",
            "p_variant_id",
            "p_limit",
            "p_offset",
          ],
          inventory_move: [
            "p_organization_id",
            "p_store_id",
            "p_variant_id",
            "p_kind",
            "p_quantity",
            "p_reason",
            "p_expected_revision",
            "p_idempotency_key",
          ],
          catalog_search_products: [
            "p_organization_id",
            "p_store_id",
            "p_query",
            "p_category_id",
            "p_active",
            "p_limit",
            "p_offset",
          ],
          catalog_create_category: [
            "p_organization_id",
            "p_store_id",
            "p_name",
          ],
          catalog_update_category: [
            "p_organization_id",
            "p_store_id",
            "p_category_id",
            "p_expected_revision",
            "p_name",
            "p_active",
          ],
          catalog_create_product: [
            "p_organization_id",
            "p_store_id",
            "p_name",
            "p_description",
            "p_category_id",
            "p_sku",
            "p_color",
            "p_size",
            "p_barcode",
            "p_idempotency_key",
          ],
          catalog_update_product: [
            "p_organization_id",
            "p_store_id",
            "p_product_id",
            "p_expected_revision",
            "p_name",
            "p_description",
            "p_category_id",
            "p_active",
          ],
          catalog_create_variant: [
            "p_organization_id",
            "p_store_id",
            "p_product_id",
            "p_sku",
            "p_color",
            "p_size",
            "p_barcode",
          ],
          catalog_update_variant: [
            "p_organization_id",
            "p_store_id",
            "p_variant_id",
            "p_expected_revision",
            "p_sku",
            "p_color",
            "p_size",
            "p_barcode",
            "p_active",
          ],
          catalog_set_price: [
            "p_organization_id",
            "p_store_id",
            "p_variant_id",
            "p_expected_revision",
            "p_amount",
          ],
        };
        const rpcName = url.pathname.replace("/rest/v1/rpc/", "");
        const scopeArgs = ["p_organization_id", "p_store_id"];
        Object.assign(catalogRpcArguments, {
          procurement_suppliers: [
            ...scopeArgs,
            "p_query",
            "p_limit",
            "p_offset",
            "p_supplier_id",
          ],
          procurement_orders: [
            ...scopeArgs,
            "p_query",
            "p_status",
            "p_limit",
            "p_offset",
            "p_order_id",
          ],
          procurement_order_items: [...scopeArgs, "p_order_id"],
          procurement_save_supplier: [
            ...scopeArgs,
            "p_supplier_id",
            "p_name",
            "p_contact",
            "p_active",
            "p_expected_revision",
            "p_idempotency_key",
          ],
          procurement_create_order: [
            ...scopeArgs,
            "p_supplier_id",
            "p_items",
            "p_idempotency_key",
          ],
          procurement_receive_order: [
            ...scopeArgs,
            "p_order_id",
            "p_expected_revision",
            "p_idempotency_key",
          ],
          procurement_cancel_order: [
            ...scopeArgs,
            "p_order_id",
            "p_expected_revision",
            "p_reason",
            "p_idempotency_key",
          ],
        });
        const argumentNames = catalogRpcArguments[rpcName];
        if (url.pathname.startsWith("/rest/v1/rpc/") && argumentNames) {
          const placeholders = argumentNames
            .map((_, index) => "$" + (index + 1))
            .join(",");
          const values = argumentNames.map((name) =>
            name === "p_items"
              ? JSON.stringify(body[name] ?? null)
              : (body[name] ?? null),
          );
          const result = await db.query(
            "select * from public." + rpcName + "(" + placeholders + ")",
            values,
          );
          return reply(response, 200, result.rows);
        }
        const table = url.pathname.split("/").at(-1);
        if (
          ![
            "organizations",
            "stores",
            "memberships",
            "product_categories",
            "products",
            "product_variants",
            "product_prices",
            "product_images",
          ].includes(table)
        )
          return reply(response, 404, { message: "Unknown fixture route" });
        let query = `select * from public.${table}`;
        const values = [];
        const clauses = [];
        for (const field of [
          "user_id",
          "active",
          "organization_id",
          "id",
          "product_id",
          "store_id",
          "variant_id",
        ]) {
          const value = url.searchParams.get(field);
          if (value?.startsWith("eq.")) {
            values.push(value.slice(3));
            clauses.push(`${field}=$${values.length}`);
          } else if (value?.startsWith("in.(") && value.endsWith(")")) {
            const candidates = value.slice(4, -1).split(",");
            if (
              candidates.length < 1 ||
              candidates.length > 100 ||
              candidates.some(
                (candidate) => !/^[0-9a-f-]{36}$/i.test(candidate),
              )
            )
              return reply(response, 400, {
                message: "Invalid fixture filter",
              });
            values.push(candidates);
            clauses.push(`${field}=any($${values.length}::uuid[])`);
          }
        }
        if (clauses.length) query += " where " + clauses.join(" and ");
        return reply(response, 200, (await db.query(query, values)).rows);
      } catch (error) {
        reply(
          response,
          error.code === "42501" ? 403 : error.code === "PT409" ? 409 : 500,
          {
            message: error.message,
            code: error.code,
          },
        );
      }
    })
    .catch(() => reply(response, 500, { message: "Fixture failed" }));
}).listen(54329, "127.0.0.1", () =>
  console.log("Test contract server ready on 54329"),
);
