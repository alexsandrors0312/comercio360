import assert from "node:assert/strict";
import { test } from "node:test";
import worker, { runCatalogCleanup, validateEnv } from "../src/index.mjs";

const env = {
  ALLOW_CATALOG_IMAGE_CLEANUP: "yes",
  SUPABASE_URL: "https://qiwblpmocldqbijbylwg.supabase.co",
  SUPABASE_SECRET_KEY: "fixture-only",
};
const firstRun = Date.parse("2026-10-03T12:00:00.000Z");

function fakeAdmin({ failRemove = false, failFinish = false } = {}) {
  const object = {
    object_id: "fixture-object",
    object_path: "private/fixture/never-log-this-path",
    state: "cleanup_pending",
    updatedAt: firstRun - 3 * 60 * 60 * 1000,
  };
  let now = firstRun;
  const calls = [];
  return {
    object,
    calls,
    setNow(value) {
      now = value;
    },
    setRemovalFailure(value) {
      failRemove = value;
    },
    admin: {
      rpc: async (name, params) => {
        calls.push({ name, params });
        if (name === "catalog_claim_image_cleanup") {
          if (
            !["cleanup_pending", "deleting"].includes(object.state) ||
            object.updatedAt >= Date.parse(params.p_before)
          )
            return { data: [], error: null };
          object.state = "deleting";
          object.updatedAt = now;
          return {
            data: [
              { object_id: object.object_id, object_path: object.object_path },
            ],
            error: null,
          };
        }
        assert.equal(name, "catalog_finish_image_cleanup");
        if (failFinish) return { data: null, error: new Error("secret") };
        object.state = params.p_deleted ? "deleted" : "cleanup_pending";
        object.updatedAt = now;
        return { data: null, error: null };
      },
      storage: {
        from(bucket) {
          assert.equal(bucket, "catalog-private");
          return {
            async remove(paths) {
              assert.deepEqual(paths, [object.object_path]);
              if (failRemove) throw new Error("secret path and token in transport");
              return { error: null };
            },
          };
        },
      },
    },
  };
}

test("rejects every target except the accepted development project", () => {
  assert.equal(validateEnv(env).url, env.SUPABASE_URL);
  for (const patch of [
    { ALLOW_CATALOG_IMAGE_CLEANUP: "" },
    { SUPABASE_URL: "https://wrong.supabase.co" },
    { SUPABASE_URL: "http://qiwblpmocldqbijbylwg.supabase.co" },
    { SUPABASE_SECRET_KEY: "" },
  ]) {
    assert.throws(() => validateEnv({ ...env, ...patch }));
  }
});

test("claims in bounded pages and retries a failed removal after grace", async () => {
  const fixture = fakeAdmin({ failRemove: true });
  const failed = await runCatalogCleanup(env, {
    admin: fixture.admin,
    now: firstRun,
  });
  assert.deepEqual(failed, { claimed: 1, deleted: 0, failed: 1 });
  assert.equal(fixture.object.state, "cleanup_pending");
  assert.deepEqual(fixture.calls[0].params, {
    p_before: new Date(firstRun - 2 * 60 * 60 * 1000).toISOString(),
    p_limit: 16,
  });

  fixture.setNow(firstRun + 60 * 60 * 1000);
  assert.deepEqual(
    await runCatalogCleanup(env, {
      admin: fixture.admin,
      now: firstRun + 60 * 60 * 1000,
    }),
    { claimed: 0, deleted: 0, failed: 0 },
  );
  fixture.setNow(firstRun + 3 * 60 * 60 * 1000);
  fixture.setRemovalFailure(false);
  assert.deepEqual(
    await runCatalogCleanup(env, {
      admin: fixture.admin,
      now: firstRun + 3 * 60 * 60 * 1000,
    }),
    { claimed: 1, deleted: 1, failed: 0 },
  );
  assert.equal(fixture.object.state, "deleted");
});

test("Cron failure is recorded without object path or transport detail", async () => {
  const fixture = fakeAdmin({ failRemove: true });
  const lines = [];
  const oldLog = console.log;
  console.log = (line) => lines.push(line);
  try {
    await assert.rejects(
      worker.scheduled({}, env, undefined, {
        admin: fixture.admin,
        now: firstRun,
      }),
      /catalog cleanup failed/,
    );
  } finally {
    console.log = oldLog;
  }
  assert.equal(lines.length, 1);
  const report = JSON.parse(lines[0]);
  assert.equal(report.status, "partial_failure");
  assert.equal(report.event, "catalog_cleanup");
  assert.deepEqual(
    { claimed: report.claimed, deleted: report.deleted, failed: report.failed },
    { claimed: 1, deleted: 0, failed: 1 },
  );
  assert.doesNotMatch(lines[0], /fixture-only|never-log-this-path|secret path/);
});

test("finalization error fails the Cron with sanitized counts", async () => {
  const fixture = fakeAdmin({ failFinish: true });
  const lines = [];
  const oldLog = console.log;
  console.log = (line) => lines.push(line);
  try {
    await assert.rejects(
      worker.scheduled({}, env, undefined, {
        admin: fixture.admin,
        now: firstRun,
      }),
      /catalog cleanup failed/,
    );
  } finally {
    console.log = oldLog;
  }
  assert.equal(lines.length, 1);
  const report = JSON.parse(lines[0]);
  assert.equal(report.status, "error");
  assert.equal(report.claimed, 1);
  assert.doesNotMatch(lines[0], /secret|never-log-this-path/);
});

test("stops at 16 objects within the Workers Free subrequest budget", async () => {
  let remaining = 105;
  const sizes = [];
  const admin = {
    async rpc(name, params) {
      if (name === "catalog_claim_image_cleanup") {
        sizes.push(params.p_limit);
        const count = Math.min(remaining, params.p_limit);
        remaining -= count;
        return {
          data: Array.from({ length: count }, (_, i) => ({
            object_id: `fixture-${remaining}-${i}`,
            object_path: `fixture/${remaining}/${i}`,
          })),
          error: null,
        };
      }
      assert.equal(name, "catalog_finish_image_cleanup");
      return { data: null, error: null };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "catalog-private");
        return { remove: async () => ({ error: null }) };
      },
    },
  };
  assert.deepEqual(await runCatalogCleanup(env, { admin, now: firstRun }), {
    claimed: 16,
    deleted: 16,
    failed: 0,
  });
  assert.deepEqual(sizes, [16]);
  assert.equal(remaining, 89);
});
