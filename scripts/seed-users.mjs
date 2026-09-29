// Run only against an explicitly approved disposable development Supabase project.
import { createClient } from "@supabase/supabase-js";
import { validateSeedTarget, assertFictionalAccounts } from "./seed-guard.mjs";
import {
  seedPreflightExitCode,
  seedFailureExitCode,
} from "./seed-diagnostics.mjs";
let stage = 0;
try {
  const { url, key, password } = validateSeedTarget(process.env);
  const specs = [
    {
      email: "gerente.aurora@example.test",
      name: "Gerente fictício Aurora",
      org: "10000000-0000-4000-8000-000000000001",
      role: "manager",
      stores: [
        "10000000-0000-4000-8000-000000000011",
        "10000000-0000-4000-8000-000000000012",
      ],
    },
    {
      email: "caixa.aurora@example.test",
      name: "Caixa fictício Aurora",
      org: "10000000-0000-4000-8000-000000000001",
      role: "cashier",
      stores: ["10000000-0000-4000-8000-000000000011"],
    },
    {
      email: "gerente.horizonte@example.test",
      name: "Gerente fictício Horizonte",
      org: "20000000-0000-4000-8000-000000000001",
      role: "manager",
      stores: ["20000000-0000-4000-8000-000000000011"],
    },
    {
      email: "sem.vinculo@example.test",
      name: "Sem vínculo fictício",
      org: null,
      role: null,
      stores: [],
    },
  ];
  // Validate the complete batch before constructing the client or performing any API call.
  assertFictionalAccounts(specs);
  stage = 4;
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  function must(result) {
    if (result.error) throw result.error;
    return result.data;
  }
  stage = 6;
  const users = [];
  for (let page = 1; ; page++) {
    const data = must(
      await admin.auth.admin.listUsers({ page, perPage: 1000 }),
    );
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  // Read-only check before creating any Auth identity: the SQL seed must exist.
  stage = 5;
  const orgIds = [
    ...new Set(specs.flatMap((spec) => (spec.org ? [spec.org] : []))),
  ];
  const storeIds = specs.flatMap((spec) => spec.stores);
  const orgs = must(
    await admin.from("organizations").select("id").in("id", orgIds),
  );
  const stores = must(
    await admin.from("stores").select("id").in("id", storeIds),
  );
  if (
    orgIds.some((id) => !orgs.some((org) => org.id === id)) ||
    storeIds.some((id) => !stores.some((store) => store.id === id))
  ) {
    throw Object.assign(new Error("SQL seed missing"), {
      code: "H1_MISSING_SEED",
    });
  }
  for (const spec of specs) {
    let user = users.find((u) => u.email === spec.email);
    stage = 7;
    if (!user)
      user = must(
        await admin.auth.admin.createUser({
          email: spec.email,
          password,
          email_confirm: true,
        }),
      ).user;
    stage = 8;
    must(
      await admin
        .from("profiles")
        .upsert({ id: user.id, display_name: spec.name }),
    );
    if (spec.org) {
      stage = 9;
      const membership = must(
        await admin
          .from("memberships")
          .upsert(
            {
              organization_id: spec.org,
              user_id: user.id,
              role: spec.role,
              active: true,
            },
            { onConflict: "organization_id,user_id" },
          )
          .select("id")
          .single(),
      );
      stage = 10;
      for (const store of spec.stores)
        must(
          await admin.from("user_store_access").upsert(
            {
              organization_id: spec.org,
              membership_id: membership.id,
              store_id: store,
            },
            { onConflict: "organization_id,membership_id,store_id" },
          ),
        );
    }
    console.log(`Prepared fictional account: ${spec.email}`);
  }
  console.log("Existing passwords are preserved. No credentials were printed.");
} catch (error) {
  const code =
    stage === 0
      ? seedPreflightExitCode(process.env)
      : seedFailureExitCode(stage, error);
  console.log(`H1-SEED-${code}`);
  process.exitCode = code;
}
