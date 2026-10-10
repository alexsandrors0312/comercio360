import { describe, expect, it } from "vitest";
import {
  customerCharacterCount,
  normalizeCustomerEmail,
  normalizeCustomerName,
  normalizeCustomerPhone,
} from "../packages/domain/customers";
import {
  customerEmailSchema,
  customerHistorySchema,
  customerListSchema,
  customerNameSchema,
  customerPhoneSchema,
  customerSaveSchema,
  customerSearchSchema,
} from "../packages/validation/customers";
import { saleSchema } from "../packages/validation/sales";

const customerId = "aaaaaaaa-0000-4000-8000-000000000001";
const key = "bbbbbbbb-0000-4000-8000-000000000001";
const variantId = "cccccccc-0000-4000-8000-000000000001";
const create = {
  customerId: null,
  expectedRevision: null,
  name: " Maria Silva ",
  phone: " (11) 98765-4321 ",
  email: " MARIA@EXAMPLE.COM ",
  active: true,
  idempotencyKey: key,
};

describe("Clientes 006 — normalization and boundaries", () => {
  it("keeps Unicode names and measures characters rather than UTF-16 units", () => {
    expect(normalizeCustomerName("\u00a0👕 Ana\ufeff")).toBe("👕 Ana");
    expect(customerCharacterCount("👕👕")).toBe(2);
    expect(customerNameSchema.parse(" 👕👕 ")).toBe("👕👕");
    expect(customerNameSchema.safeParse("👕".repeat(120)).success).toBe(true);
    expect(customerNameSchema.safeParse("👕".repeat(121)).success).toBe(false);
  });

  it("rejects blank, short, long and control-bearing names", () => {
    for (const value of [
      " ",
      "a",
      "a".repeat(121),
      "A\0B",
      "A\u0085B",
      "A\nB",
    ]) {
      expect(customerNameSchema.safeParse(value).success, value).toBe(false);
    }
  });

  it("normalizes phone to ASCII digits without dropping leading zeroes", () => {
    expect(normalizeCustomerPhone(" +55 (11) 09876-5432 ")).toBe(
      "5511098765432",
    );
    expect(customerPhoneSchema.parse(" 0012-3456 ")).toBe("00123456");
    expect(customerPhoneSchema.parse("  ")).toBeNull();
    expect(customerPhoneSchema.parse(null)).toBeNull();
    expect(customerPhoneSchema.parse(undefined)).toBeNull();
    expect(customerPhoneSchema.safeParse("0".repeat(15)).success).toBe(true);
    for (const value of [
      "1234567",
      "1".repeat(16),
      "abc",
      "０１２３４５６７",
    ]) {
      expect(customerPhoneSchema.safeParse(value).success, value).toBe(false);
    }
  });

  it("normalizes optional email and checks its syntax and length", () => {
    expect(normalizeCustomerEmail(" Maria@Example.COM ")).toBe(
      "maria@example.com",
    );
    expect(customerEmailSchema.parse(" \u00a0MARIA@EXAMPLE.COM\ufeff ")).toBe(
      "maria@example.com",
    );
    expect(customerEmailSchema.parse("   ")).toBeNull();
    expect(customerEmailSchema.parse(null)).toBeNull();
    for (const value of [
      "maria",
      "a@",
      "a\0b@example.com",
      `${"x".repeat(250)}@a.co`,
    ]) {
      expect(customerEmailSchema.safeParse(value).success, value).toBe(false);
    }
  });

  it("normalizes create payload and permits name-only contact without deduping", () => {
    expect(customerSaveSchema.parse(create)).toEqual({
      customerId: null,
      expectedRevision: null,
      name: "Maria Silva",
      phone: "11987654321",
      email: "maria@example.com",
      active: true,
      idempotencyKey: key,
    });
    const nameOnly = customerSaveSchema.parse({
      ...create,
      phone: " ",
      email: " ",
    });
    expect(nameOnly.phone).toBeNull();
    expect(nameOnly.email).toBeNull();
    expect(
      customerSaveSchema.parse({ ...create, idempotencyKey: customerId }).name,
    ).toBe("Maria Silva");
  });

  it("requires a matching ID and positive exact revision for an edit", () => {
    expect(
      customerSaveSchema.parse({
        ...create,
        customerId: customerId.toUpperCase(),
        expectedRevision: "9223372036854775807",
        idempotencyKey: key.toUpperCase(),
      }),
    ).toMatchObject({
      customerId,
      expectedRevision: "9223372036854775807",
      idempotencyKey: key,
    });
    for (const pair of [
      { customerId, expectedRevision: null },
      { customerId: null, expectedRevision: "1" },
      { customerId, expectedRevision: "0" },
      { customerId, expectedRevision: "01" },
      { customerId, expectedRevision: "9223372036854775808" },
    ]) {
      expect(customerSaveSchema.safeParse({ ...create, ...pair }).success).toBe(
        false,
      );
    }
    expect(
      customerSaveSchema.safeParse({ ...create, idempotencyKey: "retry" })
        .success,
    ).toBe(false);
    expect(
      customerSaveSchema.safeParse({ ...create, active: false }).success,
    ).toBe(false);
    expect(
      customerSaveSchema.safeParse({
        ...create,
        customerId,
        expectedRevision: "1",
        active: false,
      }).success,
    ).toBe(true);
  });

  it("bounds searches and pagination, including a normalized detail ID", () => {
    expect(customerListSchema.parse({ query: "  Ana  " })).toEqual({
      query: "Ana",
      status: "all",
      page: 1,
      pageSize: 20,
      customerId: null,
    });
    expect(
      customerListSchema.parse({
        customerId: customerId.toUpperCase(),
        status: "inactive",
        page: 2,
        pageSize: 100,
      }).customerId,
    ).toBe(customerId);
    expect(customerHistorySchema.parse({ customerId }).page).toBe(1);
    expect(customerSearchSchema.parse({ query: "  Maria " }).query).toBe(
      "Maria",
    );
    for (const query of ["x".repeat(201), "A\0B"]) {
      expect(customerSearchSchema.safeParse({ query }).success).toBe(false);
    }
    for (const pageSize of [0, 101, 1.5]) {
      expect(customerListSchema.safeParse({ pageSize }).success).toBe(false);
    }
  });
});

describe("PDV 005 replay shape remains valid with optional customer", () => {
  const sale = {
    items: [{ variantId, quantity: "1", expectedUnitPriceCents: 1999 }],
    idempotencyKey: key,
  };
  it("keeps an absent customer absent from normalized legacy payload", () => {
    expect(saleSchema.parse(sale)).toEqual({
      items: [{ variantId, quantity: 1, expectedUnitPriceCents: 1999 }],
      idempotencyKey: key,
    });
  });
  it("accepts explicit null or lowercases a selected customer ID", () => {
    expect(
      saleSchema.parse({ ...sale, customerId: null }).customerId,
    ).toBeNull();
    expect(
      saleSchema.parse({ ...sale, customerId: customerId.toUpperCase() })
        .customerId,
    ).toBe(customerId);
    expect(saleSchema.safeParse({ ...sale, customerId: "other" }).success).toBe(
      false,
    );
  });
});
