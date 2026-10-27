import { describe, expect, it } from "vitest";
import {
  calendarDays, inputDateTime, localDateTimeToIso, plannedDay, shiftMonth,
} from "../packages/ui/marketing/calendar";

describe("Marketing 013: calendário da loja", () => {
  it("mantém as semanas de segunda a domingo nas viradas de mês e ano", () => {
    const days = calendarDays("2026-11");
    expect(days).toHaveLength(42);
    expect(days[0]).toEqual({ key: "2026-10-26", day: 26, inMonth: false });
    expect(days.at(-1)).toEqual({ key: "2026-12-06", day: 6, inMonth: false });
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("usa São Paulo para classificar campanhas perto da meia-noite", () => {
    expect(plannedDay("2026-11-01T01:30:00.000Z")).toBe("2026-10-31");
    expect(plannedDay("2026-11-01T03:30:00.000Z")).toBe("2026-11-01");
  });

  it("converte o horário digitado na loja sem depender do fuso do navegador", () => {
    expect(localDateTimeToIso("2026-11-01T09:00")).toBe("2026-11-01T12:00:00.000Z");
    expect(inputDateTime("2026-11-01T12:00:00.000Z")).toBe("2026-11-01T09:00");
    expect(localDateTimeToIso("2026-02-30T09:00")).toBe("");
  });
});
