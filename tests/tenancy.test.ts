import { describe, it, expect } from "vitest";
import {
  selectContext,
  selectableOrganizations,
} from "../packages/domain/tenancy";
import { contextSchema, loginSchema } from "../packages/validation";
const stores = [
  { id: "store-a", organization_id: "org-a", name: "A" },
  { id: "store-b", organization_id: "org-b", name: "B" },
];
describe("context authorization", () => {
  const organizations = [
    { id: "org-a", name: "A" },
    { id: "org-b", name: "B" },
  ];
  it("excludes active memberships with no authorized stores from organization options", () => {
    expect(selectableOrganizations(organizations, [stores[0]])).toEqual([
      organizations[0],
    ]);
    expect(selectContext([stores[0]], "org-b")).toBeNull();
  });
  it("returns no selectable organization when the user has memberships but no authorized stores", () => {
    expect(selectableOrganizations(organizations, [])).toEqual([]);
    expect(selectContext([], "org-b")).toBeNull();
  });
  it("preserves authorized multi-organization choices and never manufactures an unknown organization", () => {
    expect(selectableOrganizations(organizations, stores)).toEqual(
      organizations,
    );
    expect(selectableOrganizations([], stores)).toEqual([]);
  });
  it("chooses only within supplied authorized stores", () => {
    expect(selectContext(stores, "org-a")?.id).toBe("store-a");
    expect(selectContext(stores, "org-b", "store-a")).toBeNull();
    expect(selectContext(stores, undefined, "forged")).toBeNull();
  });
  it("does not manufacture access for users without stores", () =>
    expect(selectContext([])).toBeNull());
  it("validates inputs before login or switching", () => {
    expect(
      contextSchema.safeParse({ organizationId: "forged", storeId: "a" })
        .success,
    ).toBe(false);
    expect(
      loginSchema.safeParse({ email: "invalid", password: "x" }).success,
    ).toBe(false);
  });
});
