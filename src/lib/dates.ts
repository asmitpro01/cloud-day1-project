export const IST_TIME_ZONE = "Asia/Kolkata";

// IST is a fixed UTC+05:30 with no daylight saving, so a constant offset is exact.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const DATE_FORMAT = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** Shifts a UTC instant so its UTC fields read as IST wall-clock fields. */
function toIstFields(date: Date): Date {
  return new Date(date.getTime() + IST_OFFSET_MS);
}

/** `24 Oct 2026` in IST. */
export function formatDateIST(date: Date): string {
  return DATE_FORMAT.format(date);
}

/** `24 Oct 2026, 9:30 pm IST`. */
export function formatDateTimeIST(date: Date): string {
  return `${DATE_TIME_FORMAT.format(date)} IST`;
}

/** The IST calendar date as `YYYY-MM-DD`. A payment at 23:30 UTC on 31 March is `…-04-01` in IST. */
export function toIstDateString(date: Date): string {
  return toIstFields(date).toISOString().slice(0, 10);
}

/** Parses a `YYYY-MM-DD` IST calendar date into the UTC instant of its IST midnight. */
export function istDateStringToDate(isoDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new RangeError(`Expected YYYY-MM-DD, got ${isoDate}`);
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)) - IST_OFFSET_MS);
}

export type FinancialYear = {
  /** Calendar year in which the FY starts (1 April). */
  startYear: number;
  /** `2026-27`, as written on returns and statements. */
  label: string;
  /** `2627`, compact form used in invoice numbers. */
  code: string;
  /** UTC instant of 1 April 00:00 IST. */
  startsAt: Date;
  /** UTC instant of the next 1 April 00:00 IST (exclusive end). */
  endsBefore: Date;
};

/** The Indian financial year (1 April – 31 March) containing `date`, evaluated in IST. */
export function financialYearOf(date: Date): FinancialYear {
  const ist = toIstFields(date);
  const year = ist.getUTCFullYear();
  const startYear = ist.getUTCMonth() >= 3 ? year : year - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, "0");
  const startYearShort = String(startYear % 100).padStart(2, "0");
  return {
    startYear,
    label: `${startYear}-${endYearShort}`,
    code: `${startYearShort}${endYearShort}`,
    startsAt: new Date(Date.UTC(startYear, 3, 1) - IST_OFFSET_MS),
    endsBefore: new Date(Date.UTC(startYear + 1, 3, 1) - IST_OFFSET_MS),
  };
}

/** UTC instant of 00:00 IST on the first day of the IST month containing `date`. */
export function startOfIstMonth(date: Date): Date {
  const ist = toIstFields(date);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST_OFFSET_MS);
}
