import { describe, expect, it } from "vitest";
import {
  financialYearOf,
  formatDateIST,
  formatDateTimeIST,
  istDateStringToDate,
  startOfIstMonth,
  toIstDateString,
} from "./dates";

describe("toIstDateString", () => {
  it("uses the IST calendar date, not UTC", () => {
    expect(toIstDateString(new Date("2026-03-31T18:29:59.999Z"))).toBe("2026-03-31");
    expect(toIstDateString(new Date("2026-03-31T18:30:00.000Z"))).toBe("2026-04-01");
  });

  it("round-trips through istDateStringToDate", () => {
    expect(istDateStringToDate("2026-04-01").toISOString()).toBe("2026-03-31T18:30:00.000Z");
    expect(() => istDateStringToDate("01-04-2026")).toThrow(RangeError);
  });
});

describe("financialYearOf", () => {
  it("rolls over at 1 April 00:00 IST", () => {
    expect(financialYearOf(new Date("2026-03-31T18:29:59.999Z")).label).toBe("2025-26");
    expect(financialYearOf(new Date("2026-03-31T18:30:00.000Z")).label).toBe("2026-27");
  });

  it("returns label, code and bounds", () => {
    const fy = financialYearOf(new Date("2026-10-24T10:00:00Z"));
    expect(fy).toEqual({
      startYear: 2026,
      label: "2026-27",
      code: "2627",
      startsAt: new Date("2026-03-31T18:30:00.000Z"),
      endsBefore: new Date("2027-03-31T18:30:00.000Z"),
    });
  });

  it("handles January to March and century turns", () => {
    expect(financialYearOf(new Date("2027-02-15T00:00:00Z")).label).toBe("2026-27");
    expect(financialYearOf(new Date("2099-12-01T00:00:00Z")).code).toBe("9900");
  });
});

describe("formatting", () => {
  it("formats dates in IST", () => {
    const date = new Date("2026-10-24T16:00:00Z");
    expect(formatDateIST(date)).toBe("24 Oct 2026");
    expect(formatDateTimeIST(date)).toBe("24 Oct 2026, 9:30 pm IST");
  });

  it("finds the start of the IST month", () => {
    expect(startOfIstMonth(new Date("2026-10-31T19:00:00Z")).toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(startOfIstMonth(new Date("2026-10-24T10:00:00Z")).toISOString()).toBe("2026-09-30T18:30:00.000Z");
  });
});
