export type CsvColumn<Row> = { header: string; value: (row: Row) => string | number | null | undefined };

// Cells starting with these characters run as formulas in Excel/Sheets (CSV injection, OWASP).
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Escapes one CSV cell: neutralises formulas and quotes values containing separators. */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && FORMULA_PREFIX.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Builds an RFC 4180 CSV with CRLF line endings and a UTF-8 BOM, so Excel shows ₹ and
 * non-Latin names correctly.
 */
export function toCsv<Row>(rows: readonly Row[], columns: readonly CsvColumn<Row>[]): string {
  const lines = [
    columns.map((column) => escapeCsvCell(column.header)).join(","),
    ...rows.map((row) => columns.map((column) => escapeCsvCell(column.value(row))).join(",")),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}
