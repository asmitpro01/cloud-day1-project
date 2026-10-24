import { describe, expect, it } from "vitest";
import { escapeCsvCell, toCsv } from "./csv";

describe("escapeCsvCell", () => {
  it("neutralises spreadsheet formulas", () => {
    expect(escapeCsvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(escapeCsvCell("+91 98765")).toBe("'+91 98765");
    expect(escapeCsvCell("-2+3")).toBe("'-2+3");
    expect(escapeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("quotes separators and leaves numbers alone", () => {
    expect(escapeCsvCell("Sharma, Riya")).toBe('"Sharma, Riya"');
    expect(escapeCsvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(escapeCsvCell(-42)).toBe("-42");
    expect(escapeCsvCell(null)).toBe("");
  });
});

describe("toCsv", () => {
  it("writes a BOM, headers and CRLF rows", () => {
    const csv = toCsv(
      [{ name: "आरव", email: "a@example.com" }],
      [
        { header: "Name", value: (row) => row.name },
        { header: "Email", value: (row) => row.email },
      ],
    );
    expect(csv).toBe("﻿Name,Email\r\nआरव,a@example.com\r\n");
  });
});
