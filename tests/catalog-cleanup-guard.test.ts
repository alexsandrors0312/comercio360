import { describe, expect, it } from "vitest";
import { validateCatalogCleanupEnv } from "../scripts/catalog-image-cleanup.mjs";

const good = {
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
});
