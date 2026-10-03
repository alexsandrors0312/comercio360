import { describe, expect, it } from "vitest";
import {
  catalogCleanupExitCode,
  runCatalogImageCleanup,
  validateCatalogCleanupEnv,
} from "../scripts/catalog-image-cleanup.mjs";

const good = {
  NODE_ENV: "test" as const,
  ALLOW_CATALOG_IMAGE_CLEANUP: "yes",
  NEXT_PUBLIC_SUPABASE_URL: "https://disposable.example.test/",
  CONFIRM_SUPABASE_PROJECT_URL: "https://disposable.example.test",
  SUPABASE_SECRET_KEY: "fixture-only",
};

describe("catalog image cleanup preflight", () => {
  it("requires explicit flag, separate matching origin and a maintenance key", () => {
    expect(validateCatalogCleanupEnv(good)).toMatchObject({
      url: "https://disposable.example.test",
    });
    for (const patch of [
      { ALLOW_CATALOG_IMAGE_CLEANUP: "" },
      { CONFIRM_SUPABASE_PROJECT_URL: "https://other.example.test" },
      { SUPABASE_SECRET_KEY: "" },
      { NEXT_PUBLIC_SUPABASE_URL: "http://disposable.example.test" },
      { NEXT_PUBLIC_SUPABASE_URL: "https://user:pass@disposable.example.test" },
      { NEXT_PUBLIC_SUPABASE_URL: "https://disposable.example.test/prod" },
    ]) {
      expect(() => validateCatalogCleanupEnv({ ...good, ...patch })).toThrow();
    }
  });

  it("returns a failed deletion to the delayed retry queue and reports an unhealthy run", async () => {
    const firstRun = Date.parse("2026-10-03T12:00:00.000Z");
    const object = {
      object_id: "fixture-object",
      object_path: "fixture/path",
      state: "cleanup_pending",
      updatedAt: firstRun - 3 * 60 * 60 * 1000,
    };
    let now = firstRun;
    let failRemoval = true;
    const admin = {
      rpc: async (name: string, params: Record<string, unknown>) => {
        if (name === "catalog_claim_image_cleanup") {
          if (
            object.state !== "cleanup_pending" ||
            object.updatedAt >= Date.parse(params.p_before as string)
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
        if (
          name !== "catalog_finish_image_cleanup" ||
          params.p_object_id !== object.object_id
        )
          throw new Error("unexpected RPC");
        object.state = params.p_deleted ? "deleted" : "cleanup_pending";
        object.updatedAt = now;
        return { data: null, error: null };
      },
      storage: {
        from: (bucket: string) => {
          expect(bucket).toBe("catalog-private");
          return {
            remove: async (paths: string[]) => {
              expect(paths).toEqual([object.object_path]);
              if (failRemoval)
                throw new Error("transient transport failure with secret path");
              return { error: null };
            },
          };
        },
      },
    };

    const failed = await runCatalogImageCleanup(good, { admin, now });
    expect(failed).toEqual({ claimed: 1, deleted: 0, failed: 1 });
    expect(catalogCleanupExitCode(failed)).toBe(1);
    expect(object.state).toBe("cleanup_pending");

    // SQL requires two hours of age before another claim, avoiding a hot retry loop.
    now += 60 * 60 * 1000;
    expect(await runCatalogImageCleanup(good, { admin, now })).toEqual({
      claimed: 0,
      deleted: 0,
      failed: 0,
    });
    now += 2 * 60 * 60 * 1000;
    failRemoval = false;
    const recovered = await runCatalogImageCleanup(good, { admin, now });
    expect(recovered).toEqual({ claimed: 1, deleted: 1, failed: 0 });
    expect(catalogCleanupExitCode(recovered)).toBe(0);
    expect(object.state).toBe("deleted");
  });
});
