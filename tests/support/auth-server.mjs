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
])
  await db.exec(
    readFileSync(new URL("../../supabase/" + file, import.meta.url), "utf8"),
  );
const tokens = new Map();
const identities = {
  "gerente.aurora@example.test": "a",
  "gerente.horizonte@example.test": "b",
  "caixa.aurora@example.test": "c",
  "sem.vinculo@example.test": "d",
  "multiempresa@example.test": "e",
  "sem.loja@example.test": "f",
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
        const table = url.pathname.split("/").at(-1);
        if (!["organizations", "stores", "memberships"].includes(table))
          return reply(response, 404, { message: "Unknown fixture route" });
        let query = `select * from public.${table}`;
        const values = [];
        const clauses = [];
        for (const field of ["user_id", "active"]) {
          const value = url.searchParams.get(field);
          if (value?.startsWith("eq.")) {
            values.push(value.slice(3));
            clauses.push(`${field}=$${values.length}`);
          }
        }
        if (clauses.length) query += " where " + clauses.join(" and ");
        return reply(response, 200, (await db.query(query, values)).rows);
      } catch (error) {
        reply(response, error.code === "42501" ? 403 : 500, {
          message: error.message,
          code: error.code,
        });
      }
    })
    .catch(() => reply(response, 500, { message: "Fixture failed" }));
}).listen(54329, "127.0.0.1", () =>
  console.log("Test contract server ready on 54329"),
);
