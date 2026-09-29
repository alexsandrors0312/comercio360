// Opt-in hosted homologation. No Playwright reporter, trace, screenshot or storageState.
// Run only via scripts/h1-manual.ps1 after operator verification of remote migrations.
import { createClient } from "@supabase/supabase-js";
import { chromium, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { validateSeedTarget } from "../../scripts/seed-guard.mjs";
import {
  waitForExpiry,
  responseClockOffset,
  expiredResponseEvidence,
  CLOCK_SKEW_SECONDS,
  SAFETY_SECONDS,
} from "./expiry-checks.mjs";

const results = [];
const cleanup = [];
let browser, server, project;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function check(condition) {
  if (!condition) throw new Error("assertion");
}
function data(response) {
  check(!response.error);
  return response.data;
}
async function run(
  name,
  operation,
  { evidence, continueOnFailure = false } = {},
) {
  try {
    await operation();
    results.push({
      test: name,
      result: "PASS",
      ...(evidence ? { evidence } : {}),
    });
    console.log(`PASS: ${name}`);
  } catch {
    // Never serialize provider errors, requests, headers, assertions or tokens.
    results.push({
      test: name,
      result: "FAIL",
      ...(evidence ? { evidence } : {}),
    });
    console.log(`FAIL: ${name}. Diagnostico sensivel omitido.`);
    if (!continueOnFailure) throw new Error("stop");
  }
}
const A = "10000000-0000-4000-8000-000000000001";
const B = "20000000-0000-4000-8000-000000000001";
const A1 = "10000000-0000-4000-8000-000000000011";
const A2 = "10000000-0000-4000-8000-000000000012";
const B1 = "20000000-0000-4000-8000-000000000011";
const base = "http://127.0.0.1:3002";
const identities = [
  "gerente.aurora",
  "caixa.aurora",
  "gerente.horizonte",
  "sem.vinculo",
];
const sessions = new Map();
let expiredToken, expiry, browserExpiry, browserToken;
// SDK diagnostics must not serialize provider responses into the operator's terminal.
console.warn = () =>
  console.log("SDK: aviso omitido; o resultado sera validado pelo teste.");
console.error = () =>
  console.log(
    "SDK: diagnostico omitido; o resultado sera validado pelo teste.",
  );

try {
  const { url, key, password } = validateSeedTarget(process.env);
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const linked = readFileSync("supabase/.temp/project-ref", "utf8").trim();
  check(publicKey && new URL(url).hostname === `${linked}.supabase.co`);
  project = linked;
  // The administrative key remains only in this process's client memory.
  for (const name of [
    "SUPABASE_SECRET_KEY",
    "SEED_PASSWORD",
    "ALLOW_DEVELOPMENT_SEED",
    "CONFIRM_SUPABASE_PROJECT_URL",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_DB_PASSWORD",
  ])
    delete process.env[name];
  const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  };
  const admin = createClient(url, key, options);
  const userClient = () => createClient(url, publicKey, options);
  const raw = async (token, path, method = "GET", payload) => {
    const response = await fetch(`${url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: publicKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  };
  await run(
    "Preflight: seed de duas empresas e tres lojas presente",
    async () => {
      const orgs = data(
        await admin.from("organizations").select("id").in("id", [A, B]),
      );
      const stores = data(
        await admin.from("stores").select("id").in("id", [A1, A2, B1]),
      );
      check(orgs.length === 2 && stores.length === 3);
    },
  );
  await run(
    "Auth hospedado: cadastro publico desativado e email habilitado",
    async () => {
      const response = await fetch(`${url}/auth/v1/settings`, {
        headers: { apikey: publicKey },
      });
      const settings = await response.json();
      check(
        response.ok &&
          settings.disable_signup === true &&
          settings.external?.email === true,
      );
    },
  );
  await run(
    "Auth real: login valido nas quatro identidades ficticias",
    async () => {
      for (const identity of identities) {
        const client = userClient();
        const auth = data(
          await client.auth.signInWithPassword({
            email: `${identity}@example.test`,
            password,
          }),
        );
        check(auth.session && auth.user);
        sessions.set(identity, {
          client,
          user: auth.user.id,
          token: auth.session.access_token,
        });
      }
    },
  );
  const manager = sessions.get(identities[0]);
  const cashier = sessions.get(identities[1]);
  const horizon = sessions.get(identities[2]);
  const noMember = sessions.get(identities[3]);
  const member = data(
    await admin
      .from("memberships")
      .select("*")
      .eq("user_id", manager.user)
      .eq("organization_id", A)
      .single(),
  );
  const cashierMember = data(
    await admin
      .from("memberships")
      .select("*")
      .eq("user_id", cashier.user)
      .eq("organization_id", A)
      .single(),
  );
  const horizonMember = data(
    await admin
      .from("memberships")
      .select("*")
      .eq("user_id", horizon.user)
      .eq("organization_id", B)
      .single(),
  );
  const access = data(
    await admin
      .from("user_store_access")
      .select("*")
      .eq("membership_id", cashierMember.id)
      .eq("store_id", A1)
      .single(),
  );
  const store = data(
    await admin.from("stores").select("*").eq("id", A1).single(),
  );
  await run("Auth real: senha invalida recusada", async () => {
    const result = await userClient().auth.signInWithPassword({
      email: `${identities[0]}@example.test`,
      password: randomUUID(),
    });
    check(result.error && !result.data.session);
  });
  await run("Auth real: renovacao e validacao no servidor", async () => {
    const renewed = data(await manager.client.auth.refreshSession());
    check(renewed.session && renewed.session.refresh_token);
    check(data(await manager.client.auth.getUser()).user.id === manager.user);
    manager.token = renewed.session.access_token;
    expiredToken = renewed.session.access_token;
    expiry = renewed.session.expires_at;
    check(Number.isFinite(expiry));
  });
  await run(
    "REST RLS: matriz gerente A=A1/A2, caixa A=A1, gerente B=B1, sem vinculo=vazio",
    async () => {
      for (const [session, expected] of [
        [manager, [A1, A2]],
        [cashier, [A1]],
        [horizon, [B1]],
        [noMember, []],
      ]) {
        const response = await raw(session.token, "stores?select=id");
        check(
          response.status === 200 &&
            JSON.stringify(response.body.map((row) => row.id).sort()) ===
              JSON.stringify(expected.sort()),
        );
      }
    },
  );
  await run(
    "REST RLS: IDs conhecidos de outro tenant retornam zero linhas",
    async () => {
      for (const [session, org, unit] of [
        [manager, B, B1],
        [cashier, B, B1],
        [horizon, A, A1],
      ]) {
        for (const path of [
          `organizations?id=eq.${org}`,
          `stores?id=eq.${unit}`,
          `memberships?organization_id=eq.${org}`,
          `user_store_access?organization_id=eq.${org}`,
          `audit_events?organization_id=eq.${org}`,
        ]) {
          const response = await raw(session.token, path);
          check(
            response.status === 200 &&
              Array.isArray(response.body) &&
              response.body.length === 0,
          );
        }
      }
    },
  );
  await run(
    "REST RLS: insert/update cruzados e RPC sem acesso rejeitados com JWT de usuario",
    async () => {
      for (const [session, org, unit] of [
        [manager, B, B1],
        [horizon, A, A1],
        [cashier, A, A2],
      ]) {
        const insert = await raw(session.token, "stores", "POST", {
          organization_id: org,
          name: "H1 ficticio proibido",
        });
        const update = await raw(
          session.token,
          `stores?id=eq.${unit}`,
          "PATCH",
          { name: "H1 ficticio proibido" },
        );
        const rpc = await raw(session.token, "rpc/set_active_store", "POST", {
          p_organization_id: org,
          p_store_id: unit,
        });
        for (const response of [insert, update, rpc])
          check(response.status === 403 && response.body?.code === "42501");
      }
    },
  );
  const auditCount = async () => {
    const response = await admin
      .from("audit_events")
      .select("id", { count: "exact", head: true });
    check(!response.error);
    return response.count;
  };
  const guards = [
    ["organizations", "id", A, randomUUID()],
    ["stores", "id", A1, randomUUID()],
    ["stores", "organization_id", A1, B],
    ["memberships", "id", member.id, randomUUID()],
    ["memberships", "organization_id", member.id, B],
    ["memberships", "user_id", member.id, horizon.user],
    ["user_store_access", "id", access.id, randomUUID()],
    ["user_store_access", "organization_id", access.id, B],
    ["user_store_access", "membership_id", access.id, horizonMember.id],
    ["user_store_access", "store_id", access.id, A2],
  ];
  for (const [table, field, id, value] of guards) {
    await run(
      `Trigger hospedado: ${table}.${field} imutavel; registro e auditoria intactos`,
      async () => {
        const before = data(
          await admin.from(table).select("*").eq("id", id).single(),
        );
        const count = await auditCount();
        const denied = await admin
          .from(table)
          .update({ [field]: value })
          .eq("id", id)
          .select();
        check(
          denied.error?.code === "23514" &&
            denied.error.message.includes("Structural key"),
        );
        check(
          JSON.stringify(
            data(await admin.from(table).select("*").eq("id", id).single()),
          ) === JSON.stringify(before),
        );
        check((await auditCount()) === count);
      },
    );
  }
  await run(
    "Auditoria hospedada: snapshots old/new de outro tenant rejeitados",
    async () => {
      for (const field of ["old_value", "new_value"]) {
        const result = await admin.from("audit_events").insert({
          organization_id: B,
          action: "update",
          entity_type: "stores",
          origin: "h1",
          [field]: { organization_id: A },
        });
        check(result.error?.code === "23514");
      }
      const root = await admin.from("audit_events").insert({
        organization_id: B,
        action: "update",
        entity_type: "organizations",
        origin: "h1",
        old_value: { id: A },
      });
      check(root.error?.code === "23514");
    },
  );
  cleanup.push(async () => {
    data(
      await admin
        .from("stores")
        .update({ name: store.name, active: store.active })
        .eq("id", A1),
    );
  });
  cleanup.push(async () => {
    data(
      await admin
        .from("memberships")
        .update({ role: member.role, active: member.active })
        .eq("id", member.id),
    );
  });
  await run(
    "Atualizacoes legitimas: nome, papel, ativo e chaves com mesmo valor",
    async () => {
      data(
        await admin
          .from("organizations")
          .update({ id: A })
          .eq("id", A)
          .select()
          .single(),
      );
      data(
        await admin
          .from("stores")
          .update({
            id: A1,
            organization_id: A,
            name: "Loja Centro H1 ficticia",
            active: false,
          })
          .eq("id", A1)
          .select()
          .single(),
      );
      data(
        await admin
          .from("stores")
          .update({ name: store.name, active: store.active })
          .eq("id", A1),
      );
      data(
        await admin
          .from("memberships")
          .update({
            id: member.id,
            organization_id: A,
            user_id: manager.user,
            role: "owner",
            active: false,
          })
          .eq("id", member.id)
          .select()
          .single(),
      );
      data(
        await admin
          .from("memberships")
          .update({ role: member.role, active: member.active })
          .eq("id", member.id),
      );
      data(
        await admin
          .from("user_store_access")
          .update({
            id: access.id,
            organization_id: A,
            membership_id: access.membership_id,
            store_id: A1,
          })
          .eq("id", access.id)
          .select()
          .single(),
      );
      const event = data(
        await admin
          .from("audit_events")
          .select("*")
          .eq("entity_id", A1)
          .eq("action", "update")
          .order("created_at", { ascending: false })
          .limit(1),
      )[0];
      check(
        event &&
          event.actor_user_id === null &&
          event.origin === "database" &&
          event.organization_id === A &&
          event.store_id === A1,
      );
      check(
        event.old_value?.name === "Loja Centro H1 ficticia" &&
          event.new_value?.name === store.name &&
          Number.isFinite(Date.parse(event.created_at)),
      );
    },
  );
  // Refuse to borrow an existing relationship; all temporary permissions are restored in finally.
  const existing = data(
    await admin
      .from("memberships")
      .select("id")
      .eq("user_id", manager.user)
      .eq("organization_id", B),
  );
  check(existing.length === 0);
  const extraId = randomUUID();
  cleanup.push(async () => {
    data(
      await admin
        .from("user_store_access")
        .delete()
        .eq("membership_id", extraId),
    );
    data(await admin.from("memberships").delete().eq("id", extraId));
  });
  data(
    await admin.from("memberships").insert({
      id: extraId,
      organization_id: B,
      user_id: manager.user,
      role: "manager",
    }),
  );

  await run("Servidor web isolado sem variaveis administrativas", async () => {
    try {
      await fetch(`${base}/login`, { signal: AbortSignal.timeout(1500) });
      throw new Error("occupied");
    } catch (error) {
      if (error.message === "occupied") throw error;
    }
    server = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        "3002",
      ],
      {
        env: { ...process.env, NODE_OPTIONS: "" },
        stdio: "ignore",
        windowsHide: true,
      },
    );
    server.on("error", () => {});
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (server.exitCode !== null) break;
      try {
        if ((await fetch(`${base}/login`)).ok) {
          ready = true;
          break;
        }
      } catch {
        /* startup */
      }
      await pause(1000);
    }
    check(ready);
    browser = await chromium.launch({ headless: true });
  });
  const login = async (identity, suppliedPassword = password) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${base}/login`);
    await page
      .getByLabel("E-mail", { exact: true })
      .fill(`${identity}@example.test`);
    await page.getByLabel("Senha", { exact: true }).fill(suppliedPassword);
    await page.getByRole("button", { name: "Entrar na minha loja" }).click();
    return page;
  };
  const browserSession = async (page) => {
    const cookies = (await page.context().cookies()).filter((cookie) =>
      /^sb-.+-auth-token(?:\.\d+)?$/.test(cookie.name),
    );
    cookies.sort(
      (left, right) =>
        Number(left.name.split(".").at(-1) || 0) -
        Number(right.name.split(".").at(-1) || 0),
    );
    const encoded = cookies.map((cookie) => cookie.value).join("");
    check(encoded.startsWith("base64-"));
    return JSON.parse(
      Buffer.from(encoded.slice(7), "base64url").toString("utf8"),
    );
  };
  let managerPage, cashierPage;
  await run(
    "Navegador real: login invalido nao abre area protegida",
    async () => {
      const page = await login(identities[0], randomUUID());
      await expect(
        page.getByRole("alert").filter({ hasText: "Não foi possível entrar" }),
      ).toBeVisible();
      await page.goto(`${base}/app/visao-geral`);
      await expect(page).toHaveURL(/\/login/);
      await page.context().close();
    },
  );
  await run(
    "Navegador real: gerente A, B sem loja omitida, troca A2 persiste ao recarregar",
    async () => {
      managerPage = await login(identities[0]);
      await expect(managerPage).toHaveURL(/\/app\/visao-geral/);
      await expect(
        managerPage.getByLabel("Empresa", { exact: true }).locator("option"),
      ).toHaveCount(1);
      await expect(
        managerPage.getByLabel("Empresa", { exact: true }),
      ).toHaveValue(A);
      await expect(
        managerPage.getByLabel("Loja", { exact: true }).locator("option"),
      ).toHaveCount(2);
      await managerPage.getByLabel("Loja", { exact: true }).selectOption(A2);
      await managerPage
        .getByRole("button", { name: "Aplicar", exact: true })
        .click();
      await expect(
        managerPage.locator("main strong").filter({ hasText: "Loja Jardim" }),
      ).toBeVisible();
      await managerPage.reload();
      await expect(managerPage.getByLabel("Loja", { exact: true })).toHaveValue(
        A2,
      );
    },
  );
  await run(
    "Navegador real: caixa restrito a A1 e cookie adulterado sem ampliacao",
    async () => {
      cashierPage = await login(identities[1]);
      await expect(cashierPage).toHaveURL(/\/app\/visao-geral/);
      await expect(
        cashierPage.getByLabel("Loja", { exact: true }).locator("option"),
      ).toHaveCount(1);
      const original = await browserSession(cashierPage);
      browserExpiry = original.expires_at;
      browserToken = original.access_token;
      check(Number.isFinite(browserExpiry) && browserToken);
      await cashierPage.context().addCookies([
        { name: "c360-org", value: B, url: base },
        { name: "c360-store", value: B1, url: base },
      ]);
      await cashierPage.reload();
      await expect(
        cashierPage.getByLabel("Empresa", { exact: true }),
      ).toHaveValue(A);
      await expect(cashierPage.getByLabel("Loja", { exact: true })).toHaveValue(
        A1,
      );
    },
  );
  await run(
    "Navegador real: Horizonte apenas B e usuario sem vinculo bloqueado",
    async () => {
      const horizonPage = await login(identities[2]);
      await expect(horizonPage).toHaveURL(/\/app\/visao-geral/);
      await expect(
        horizonPage.getByLabel("Empresa", { exact: true }),
      ).toHaveValue(B);
      await expect(
        horizonPage.getByLabel("Loja", { exact: true }).locator("option"),
      ).toHaveCount(1);
      const page = await login(identities[3]);
      await expect(page).toHaveURL(/\/sem-acesso/);
      await page.goto(`${base}/app/estoque`);
      await expect(page).toHaveURL(/\/sem-acesso/);
      await horizonPage.context().close();
      await page.context().close();
    },
  );
  const managerAccess = data(
    await admin
      .from("user_store_access")
      .select("*")
      .eq("membership_id", member.id)
      .eq("store_id", A2)
      .single(),
  );
  cleanup.push(async () => {
    data(await admin.from("user_store_access").upsert(managerAccess));
  });
  await run(
    "Revogar acesso A2 remove opcao no proximo acesso e REST retorna vazio",
    async () => {
      data(
        await admin
          .from("user_store_access")
          .delete()
          .eq("id", managerAccess.id),
      );
      await managerPage.reload();
      await expect(
        managerPage.getByLabel("Loja", { exact: true }).locator("option"),
      ).toHaveCount(1);
      await expect(managerPage.getByLabel("Loja", { exact: true })).toHaveValue(
        A1,
      );
      const response = await raw(manager.token, `stores?id=eq.${A2}`);
      check(response.status === 200 && response.body.length === 0);
      data(await admin.from("user_store_access").insert(managerAccess));
    },
  );
  cleanup.push(async () => {
    data(await admin.from("user_store_access").upsert(access));
  });
  await run(
    "Vinculo ativo sem nenhuma loja bloqueia navegador e API",
    async () => {
      data(await admin.from("user_store_access").delete().eq("id", access.id));
      await cashierPage.reload();
      await expect(cashierPage).toHaveURL(/\/sem-acesso/);
      await expect(
        cashierPage.getByText(
          "Ter vínculo com a empresa não libera acesso às lojas.",
          { exact: false },
        ),
      ).toBeVisible();
      const response = await raw(cashier.token, "stores?select=id");
      check(response.status === 200 && response.body.length === 0);
      data(await admin.from("user_store_access").insert(access));
    },
  );
  cleanup.push(async () => {
    data(
      await admin
        .from("memberships")
        .update({ active: cashierMember.active })
        .eq("id", cashierMember.id),
    );
  });
  await run(
    "Revogar vinculo bloqueia proxima requisicao e RPC com JWT ainda valido",
    async () => {
      data(
        await admin
          .from("memberships")
          .update({ active: false })
          .eq("id", cashierMember.id),
      );
      await cashierPage.goto(`${base}/app/visao-geral`);
      await expect(cashierPage).toHaveURL(/\/sem-acesso/);
      const response = await raw(
        cashier.token,
        "rpc/set_active_store",
        "POST",
        { p_organization_id: A, p_store_id: A1 },
      );
      check(response.status === 403 && response.body?.code === "42501");
      data(
        await admin
          .from("memberships")
          .update({ active: cashierMember.active })
          .eq("id", cashierMember.id),
      );
    },
  );
  await run(
    "Auditoria: ator/origem/antes/depois/loja/data e selecao consecutiva idempotente",
    async () => {
      const select = async (org, unit) => {
        data(
          await manager.client.rpc("set_active_store", {
            p_organization_id: org,
            p_store_id: unit,
          }),
        );
      };
      await select(A, A1);
      await select(A, A2);
      const count = await auditCount();
      await select(A, A2);
      check((await auditCount()) === count);
      const rows = data(
        await admin
          .from("audit_events")
          .select("*")
          .eq("actor_user_id", manager.user)
          .eq("action", "context.selected")
          .order("created_at", { ascending: false })
          .limit(1),
      );
      const event = rows[0];
      check(
        event &&
          event.organization_id === A &&
          event.store_id === A2 &&
          event.origin === "web" &&
          Number.isFinite(Date.parse(event.created_at)),
      );
      check(
        event.old_value?.organization_id === A &&
          event.old_value.store_id === A1 &&
          event.new_value?.store_id === A2,
      );
      data(
        await admin
          .from("user_store_access")
          .insert({ organization_id: B, membership_id: extraId, store_id: B1 }),
      );
      await select(B, B1);
      const cross = data(
        await admin
          .from("audit_events")
          .select("*")
          .eq("actor_user_id", manager.user)
          .eq("organization_id", B)
          .eq("action", "context.selected")
          .order("created_at", { ascending: false })
          .limit(1),
      )[0];
      check(
        cross &&
          cross.old_value === null &&
          cross.new_value.organization_id === B,
      );
      // Inspect the whole stream in pages, not the API's default first 1000 rows.
      for (let offset = 0; ; offset += 500) {
        const events = data(
          await admin
            .from("audit_events")
            .select("*")
            .order("id")
            .range(offset, offset + 499),
        );
        for (const item of events)
          for (const snapshot of [item.old_value, item.new_value]) {
            if (snapshot && "organization_id" in snapshot)
              check(snapshot.organization_id === item.organization_id);
            if (snapshot && item.entity_type === "organizations")
              check(snapshot.id === item.organization_id);
          }
        if (events.length < 500) break;
      }
    },
  );
  await run("Navegador real: logout e acesso posterior recusado", async () => {
    await managerPage.goto(`${base}/app/visao-geral`);
    await managerPage
      .getByRole("button", { name: "Sair", exact: true })
      .click();
    await expect(managerPage).toHaveURL(/\/login/);
    await managerPage.goto(`${base}/app/visao-geral`);
    await expect(managerPage).toHaveURL(/\/login/);
    check(
      !(await managerPage.context().cookies()).some(
        (cookie) => cookie.name.startsWith("sb-") && cookie.value,
      ),
    );
  });
  await run(
    "Auth real: logout revoga refresh token; JWT emitido pode durar ate expirar",
    async () => {
      const beforeLogout = data(await manager.client.auth.getSession()).session;
      check(beforeLogout?.refresh_token);
      data(await manager.client.auth.signOut());
      const refreshed = await userClient().auth.refreshSession({
        refresh_token: beforeLogout.refresh_token,
      });
      check(refreshed.error && !refreshed.data.session);
    },
  );
  // Natural expiry only. No forged JWT, changed system clock or shortened project settings.
  const timeEvidence = {
    clockSource: "http_date",
    allowanceSeconds: CLOCK_SKEW_SECONDS,
    safetySeconds: SAFETY_SECONDS,
  };
  await run(
    "Expiracao real: aguardar vencimento natural e tolerancia documentada",
    async () => {
      const started = Date.now();
      const clockResponse = await fetch(`${url}/auth/v1/settings`, {
        headers: { apikey: publicKey },
        signal: AbortSignal.timeout(15000),
      });
      check(clockResponse.ok);
      const offsetMs = responseClockOffset(
        clockResponse.headers.get("date"),
        started,
        Date.now(),
      );
      timeEvidence.clockOffsetSeconds = Math.round(offsetMs / 1000);
      await waitForExpiry([expiry, browserExpiry], {
        offsetMs,
        onWait: () =>
          console.log(
            "WAIT: aguardando expiracao natural e tolerancia de relogio; nenhum token sera registrado.",
          ),
      });
    },
    { evidence: timeEvidence },
  );
  for (const [label, token] of [
    ["API", expiredToken],
    ["navegador", browserToken],
  ]) {
    const evidence = {};
    await run(
      `Expiracao real: JWT antigo ${label} recusado por expiracao`,
      async () => {
        const response = await raw(token, "stores?select=id");
        Object.assign(evidence, expiredResponseEvidence(response));
        check(evidence.httpStatus === 401 && evidence.reason === "jwt_expired");
      },
      { evidence, continueOnFailure: true },
    );
  }
  const navigationEvidence = {};
  await run(
    "Expiracao real: navegador acessa area autorizada ao recarregar",
    async () => {
      const response = await cashierPage.goto(`${base}/app/visao-geral`);
      const pathname = new URL(cashierPage.url()).pathname;
      navigationEvidence.httpStatus = response?.status() ?? null;
      navigationEvidence.destination =
        pathname === "/app/visao-geral"
          ? "authorized"
          : pathname === "/login"
            ? "login"
            : pathname === "/sem-acesso"
              ? "no_access"
              : "other";
      check(
        navigationEvidence.httpStatus === 200 &&
          navigationEvidence.destination === "authorized",
      );
      await expect(cashierPage.getByLabel("Loja", { exact: true })).toHaveValue(
        A1,
      );
    },
    { evidence: navigationEvidence, continueOnFailure: true },
  );
  const cookieEvidence = {};
  await run(
    "Expiracao real: cookie renovado com novo token e validade posterior",
    async () => {
      const renewed = await browserSession(cashierPage);
      cookieEvidence.expiryExtended = renewed.expires_at > browserExpiry;
      cookieEvidence.tokenChanged =
        typeof renewed.access_token === "string" &&
        renewed.access_token !== browserToken;
      check(cookieEvidence.expiryExtended && cookieEvidence.tokenChanged);
    },
    { evidence: cookieEvidence, continueOnFailure: true },
  );
} catch {
  if (!results.some((result) => result.result === "FAIL"))
    results.push({ test: "Precondicao ou preparacao", result: "FAIL" });
  console.log(
    "H1 interrompido; detalhes sensiveis omitidos. Nao considerar homologado.",
  );
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
  for (const restore of cleanup.reverse()) {
    try {
      await restore();
    } catch {
      results.push({
        test: "Restauracao de fixture: revisar manualmente no ambiente descartavel",
        result: "FAIL",
      });
    }
  }
  for (const { client } of sessions.values())
    await client.auth.signOut().catch(() => {});
  const passed =
    results.length > 0 && results.every((result) => result.result === "PASS");
  const report = {
    date: new Date().toISOString(),
    version: "0.1.1",
    project,
    status: passed ? "TESTES_PASSARAM_REVISAO_PENDENTE" : "PENDENTE",
    transport:
      "Next local HTTP; Supabase hospedado HTTPS. Cookie Secure sob HTTPS da aplicacao ainda nao homologado.",
    results,
  };
  writeFileSync(
    "docs/H1_RESULTADOS.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    passed
      ? "Testes executados passaram. Relatorio requer revisao tecnica."
      : "Gate pendente; consulte docs/H1_RESULTADOS.json.",
  );
  process.exitCode = passed ? 0 : 1;
}
