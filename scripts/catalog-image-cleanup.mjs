// Out-of-band maintenance only. Never import this file into the Next runtime.
import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

function projectOrigin(value) {
  if (!value) throw new Error("target missing");
  const parsed = new URL(value);
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  if (
    !["https:", "http:"].includes(parsed.protocol) ||
    (parsed.protocol !== "https:" && !loopback) ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("target invalid");
  }
  return parsed.origin;
}

export function validateCatalogCleanupEnv(env) {
  if (env.ALLOW_CATALOG_IMAGE_CLEANUP !== "yes")
    throw new Error("cleanup flag missing");
  const url = projectOrigin(env.NEXT_PUBLIC_SUPABASE_URL);
  if (projectOrigin(env.CONFIRM_SUPABASE_PROJECT_URL) !== url)
    throw new Error("target confirmation mismatch");
  if (!env.SUPABASE_SECRET_KEY)
    throw new Error("maintenance credential missing");
  return { url, key: env.SUPABASE_SECRET_KEY };
}

export async function runCatalogImageCleanup(env = process.env) {
  const { url, key } = validateCatalogCleanupEnv(env);
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  let deleted = 0;
  let failed = 0;
  let claimed = 0;
  while (claimed < 100) {
    const batchSize = Math.min(20, 100 - claimed);
    const result = await admin.rpc("catalog_claim_image_cleanup", {
      p_before: cutoff,
      p_limit: batchSize,
    });
    if (result.error) throw new Error("cleanup claim failed");
    const rows = result.data ?? [];
    if (!rows.length) break;
    claimed += rows.length;
    for (const row of rows) {
      // The SQL claim already checked age, state and absence of active reference.
      const removed = await admin.storage
        .from("catalog-private")
        .remove([row.object_path]);
      const finished = await admin.rpc("catalog_finish_image_cleanup", {
        p_object_id: row.object_id,
        p_deleted: !removed.error,
      });
      if (finished.error) throw new Error("cleanup finalization failed");
      if (removed.error) failed++;
      else deleted++;
    }
  }
  return { claimed, deleted, failed };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = await runCatalogImageCleanup();
    console.log(
      `CATALOG-CLEANUP claimed=${result.claimed} deleted=${result.deleted} failed=${result.failed}`,
    );
  } catch {
    console.error("CATALOG-CLEANUP failed; no paths or credentials logged.");
    process.exitCode = 1;
  }
}
