import { createClient } from "@supabase/supabase-js";

// This is a separate maintenance Worker for the development project only.
const EXPECTED_ORIGIN = "https://qiwblpmocldqbijbylwg.supabase.co";
const BUCKET = "catalog-private";
// Workers Free permits 50 subrequests per Cron invocation. A full batch
// requires one claim plus one Storage DELETE and one finish RPC per object.
const MAX_OBJECTS = 16;
const BATCH_SIZE = 16;
const GRACE_MS = 2 * 60 * 60 * 1000;

export function validateEnv(env) {
  if (env.ALLOW_CATALOG_IMAGE_CLEANUP !== "yes")
    throw new Error("cleanup configuration invalid");
  if (env.SUPABASE_URL !== EXPECTED_ORIGIN)
    throw new Error("cleanup target invalid");
  if (typeof env.SUPABASE_SECRET_KEY !== "string" || !env.SUPABASE_SECRET_KEY)
    throw new Error("cleanup credential missing");
  return { url: EXPECTED_ORIGIN, key: env.SUPABASE_SECRET_KEY };
}

export async function runCatalogCleanup(env, options = {}) {
  const { url, key } = validateEnv(env);
  const admin =
    options.admin ??
    createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  const stats = options.stats ?? { claimed: 0, deleted: 0, failed: 0 };
  const cutoff = new Date((options.now ?? Date.now()) - GRACE_MS).toISOString();

  while (stats.claimed < MAX_OBJECTS) {
    const claim = await admin.rpc("catalog_claim_image_cleanup", {
      p_before: cutoff,
      p_limit: Math.min(BATCH_SIZE, MAX_OBJECTS - stats.claimed),
    });
    if (claim.error || !Array.isArray(claim.data))
      throw new Error("cleanup claim failed");
    if (claim.data.length === 0) break;
    if (claim.data.length > BATCH_SIZE)
      throw new Error("cleanup claim exceeded batch size");
    stats.claimed += claim.data.length;

    for (const row of claim.data) {
      // SQL claimed this old, unreferenced object under a row lock.
      let removed = false;
      try {
        const result = await admin.storage.from(BUCKET).remove([row.object_path]);
        removed = !result.error;
      } catch {
        // Finalize as cleanup_pending so the object can be retried after grace.
      }
      const finish = await admin.rpc("catalog_finish_image_cleanup", {
        p_object_id: row.object_id,
        p_deleted: removed,
      });
      if (finish.error) throw new Error("cleanup finalization failed");
      if (removed) stats.deleted++;
      else stats.failed++;
    }
  }
  return stats;
}

const worker = {
  async scheduled(_controller, env, _ctx, options = {}) {
    const stats = { claimed: 0, deleted: 0, failed: 0 };
    const started = Date.now();
    const record = (status) =>
      console.log(
        JSON.stringify({
          event: "catalog_cleanup",
          status,
          ...stats,
          duration_ms: Date.now() - started,
        }),
      );
    try {
      await runCatalogCleanup(env, { ...options, stats });
    } catch {
      record("error");
      // Cloudflare records a failed Cron invocation without logging raw API errors.
      throw new Error("catalog cleanup failed");
    }
    if (stats.failed > 0) {
      record("partial_failure");
      throw new Error("catalog cleanup failed");
    }
    record(stats.claimed === MAX_OBJECTS ? "saturated" : "ok");
  },
};

export default worker;
