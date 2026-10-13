import { describe, expect, it } from "vitest";
import {
  calculateOrderTotal,
  canTransitionOrder,
  MAX_ORDER_LINES,
  MAX_ORDER_TOTAL_CENTS,
  MAX_ORDER_UNIT_PRICE_CENTS,
} from "../packages/domain/orders";
import {
  orderCancelSchema,
  orderCreateSchema,
  orderFulfillSchema,
  orderListSchema,
} from "../packages/validation/orders";

const variantId = "aaaaaaaa-0000-4000-8000-000000000001";
const otherVariantId = "bbbbbbbb-0000-4000-8000-000000000001";
const customerId = "cccccccc-0000-4000-8000-000000000001";
const attemptId = "dddddddd-0000-4000-8000-000000000001";
const line = {
  variantId,
  quantity: "2",
  expectedUnitPriceCents: 1234,
};
const create = {
  channel: "counter",
  customerId: null,
  items: [line],
  idempotencyKey: attemptId,
};
const cancel = {
  orderId: variantId,
  expectedRevision: "1",
  reason: "Cliente desistiu",
  idempotencyKey: attemptId,
};

describe("Pedidos 007 — amounts and immutable state transitions", () => {
  it("uses exact sale limits, preserving a valid zero price", () => {
    expect(MAX_ORDER_LINES).toBe(50);
    expect(
      calculateOrderTotal([{ quantity: 3, expectedUnitPriceCents: 1234 }]),
    ).toBe(3702);
    expect(
      calculateOrderTotal([{ quantity: 1, expectedUnitPriceCents: 0 }]),
    ).toBe(0);
    expect(
      calculateOrderTotal([
        { quantity: 1, expectedUnitPriceCents: MAX_ORDER_UNIT_PRICE_CENTS },
        { quantity: 1, expectedUnitPriceCents: 1 },
      ]),
    ).toBe(MAX_ORDER_TOTAL_CENTS);
  });

  it("rejects oversized multiplication and aggregate before unsafe number conversion", () => {
    expect(
      calculateOrderTotal([
        {
          quantity: 1_000_000,
          expectedUnitPriceCents: MAX_ORDER_UNIT_PRICE_CENTS,
        },
      ]),
    ).toBeNull();
    expect(
      calculateOrderTotal([
        { quantity: 1, expectedUnitPriceCents: MAX_ORDER_UNIT_PRICE_CENTS },
        { quantity: 1, expectedUnitPriceCents: 2 },
      ]),
    ).toBeNull();
  });

  it("allows only open to fulfilled or cancelled", () => {
    expect(canTransitionOrder("open", "fulfilled")).toBe(true);
    expect(canTransitionOrder("open", "cancelled")).toBe(true);
    for (const current of ["fulfilled", "cancelled"] as const) {
      expect(canTransitionOrder(current, "fulfilled")).toBe(false);
      expect(canTransitionOrder(current, "cancelled")).toBe(false);
    }
  });
});

describe("Pedidos 007 — create payload", () => {
  it("normalizes UUID, quantity, and deterministic item order", () => {
    const parsed = orderCreateSchema.parse({
      ...create,
      channel: "whatsapp",
      customerId: customerId.toUpperCase(),
      idempotencyKey: attemptId.toUpperCase(),
      items: [
        { ...line, variantId: otherVariantId.toUpperCase() },
        { ...line, variantId: variantId.toUpperCase(), quantity: " 000002 " },
      ],
    });
    expect(parsed.customerId).toBe(customerId);
    expect(parsed.idempotencyKey).toBe(attemptId);
    expect(parsed.items.map((item) => item.variantId)).toEqual([
      variantId,
      otherVariantId,
    ]);
    expect(parsed.items[0].quantity).toBe(2);
  });

  it("requires a customer for WhatsApp and permits an optional counter customer", () => {
    expect(orderCreateSchema.safeParse(create).success).toBe(true);
    expect(orderCreateSchema.safeParse({ ...create, customerId }).success).toBe(
      true,
    );
    expect(
      orderCreateSchema.safeParse({ ...create, channel: "whatsapp" }).success,
    ).toBe(false);
    expect(
      orderCreateSchema.safeParse({
        ...create,
        channel: "whatsapp",
        customerId,
      }).success,
    ).toBe(true);
    expect(
      orderCreateSchema.safeParse({ ...create, channel: "instagram" }).success,
    ).toBe(false);
  });

  it("requires one to 50 unique variants, independent of UUID case", () => {
    expect(orderCreateSchema.safeParse({ ...create, items: [] }).success).toBe(
      false,
    );
    expect(
      orderCreateSchema.safeParse({
        ...create,
        items: [line, { ...line, variantId: variantId.toUpperCase() }],
      }).success,
    ).toBe(false);
    const fifty = Array.from({ length: 50 }, (_, index) => ({
      ...line,
      variantId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      quantity: "1",
    }));
    expect(
      orderCreateSchema.safeParse({ ...create, items: fifty }).success,
    ).toBe(true);
    expect(
      orderCreateSchema.safeParse({ ...create, items: [...fifty, line] })
        .success,
    ).toBe(false);
  });

  it("rejects malformed quantity and price without conflating missing with zero", () => {
    for (const quantity of ["0", "-1", "1.1", "1e2", "1000001", ""]) {
      expect(
        orderCreateSchema.safeParse({
          ...create,
          items: [{ ...line, quantity }],
        }).success,
      ).toBe(false);
    }
    for (const expectedUnitPriceCents of [
      undefined,
      null,
      "0",
      -1,
      0.5,
      MAX_ORDER_UNIT_PRICE_CENTS + 1,
    ]) {
      expect(
        orderCreateSchema.safeParse({
          ...create,
          items: [{ ...line, expectedUnitPriceCents }],
        }).success,
      ).toBe(false);
    }
    expect(
      orderCreateSchema.safeParse({
        ...create,
        items: [{ ...line, quantity: "1000000", expectedUnitPriceCents: 0 }],
      }).success,
    ).toBe(true);
  });

  it("rejects contact, conversation, address, and non-UUID attempt fields", () => {
    for (const extra of [
      { phone: "11999999999" },
      { conversation: "Olá" },
      { address: "Rua A" },
    ]) {
      expect(orderCreateSchema.safeParse({ ...create, ...extra }).success).toBe(
        false,
      );
    }
    expect(
      orderCreateSchema.safeParse({ ...create, idempotencyKey: "retry-1" })
        .success,
    ).toBe(false);
    expect(
      orderCreateSchema.safeParse({
        ...create,
        items: [{ ...line, phone: "11999999999" }],
      }).success,
    ).toBe(false);
  });
});

describe("Pedidos 007 — cancel, fulfill, and list payloads", () => {
  it("preserves exact positive bigint revision and normalizes Unicode reason", () => {
    expect(
      orderCancelSchema.parse({
        ...cancel,
        orderId: variantId.toUpperCase(),
        expectedRevision: "9223372036854775807",
        reason: "\u00a0👕👕👕\ufeff",
      }),
    ).toMatchObject({
      orderId: variantId,
      expectedRevision: "9223372036854775807",
      reason: "👕👕👕",
    });
    expect(
      orderFulfillSchema.parse({
        orderId: variantId.toUpperCase(),
        expectedRevision: "9223372036854775807",
        idempotencyKey: attemptId.toUpperCase(),
      }),
    ).toEqual({
      orderId: variantId,
      expectedRevision: "9223372036854775807",
      idempotencyKey: attemptId,
    });
  });

  it("rejects invalid revision and cancellation reason boundaries", () => {
    for (const expectedRevision of [
      "0",
      "01",
      "-1",
      "1.0",
      "9223372036854775808",
    ]) {
      expect(
        orderCancelSchema.safeParse({ ...cancel, expectedRevision }).success,
      ).toBe(false);
      expect(
        orderFulfillSchema.safeParse({
          orderId: variantId,
          expectedRevision,
          idempotencyKey: attemptId,
        }).success,
      ).toBe(false);
    }
    for (const reason of ["  ab  ", "👕".repeat(241), "a\0b"]) {
      expect(orderCancelSchema.safeParse({ ...cancel, reason }).success).toBe(
        false,
      );
    }
    expect(
      orderCancelSchema.safeParse({ ...cancel, reason: "👕".repeat(240) })
        .success,
    ).toBe(true);
  });

  it("defaults list controls and validates UUID/status/page boundaries", () => {
    expect(orderListSchema.parse({})).toEqual({
      status: "all",
      page: 1,
      pageSize: 20,
      orderId: null,
    });
    expect(
      orderListSchema.parse({
        status: "open",
        page: 100000,
        pageSize: 100,
        orderId: variantId.toUpperCase(),
      }),
    ).toMatchObject({
      status: "open",
      page: 100000,
      pageSize: 100,
      orderId: variantId,
    });
    for (const value of [
      { status: "deleted" },
      { page: 0 },
      { pageSize: 101 },
      { orderId: "all" },
    ]) {
      expect(orderListSchema.safeParse(value).success).toBe(false);
    }
  });
});
