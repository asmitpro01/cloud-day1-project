import "server-only";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { site } from "@/config/site";
import { amountInWords } from "@/lib/amount-in-words";
import { formatDateIST, istDateStringToDate } from "@/lib/dates";
import { formatRate } from "@/lib/gst/tax";
import { formatINR, paise } from "@/lib/money";
import type { InvoiceParty } from "../../db/schema";
import type { InvoiceRow } from "../create";
import { PDF_FONT_FAMILY } from "./fonts";

const BRAND = site.brand.colors.light.primary;
const MUTED = "#57534e";
const BORDER = "#d6d3d1";

const styles = StyleSheet.create({
  page: { fontFamily: PDF_FONT_FAMILY, fontSize: 9, color: "#1c1917", padding: 36, lineHeight: 1.4 },
  row: { flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  title: { fontSize: 18, fontWeight: 700, color: BRAND, textAlign: "right", lineHeight: 1.2 },
  subtitle: { fontSize: 8, color: MUTED, textAlign: "right", lineHeight: 1.4 },
  sellerName: { fontSize: 12, fontWeight: 700, lineHeight: 1.3, marginBottom: 2 },
  muted: { color: MUTED },
  bold: { fontWeight: 700 },
  box: { borderWidth: 1, borderColor: BORDER, borderRadius: 4, padding: 8 },
  label: { fontSize: 7, color: MUTED, textTransform: "uppercase", marginBottom: 2 },
  table: { borderWidth: 1, borderColor: BORDER, borderRadius: 4, marginTop: 14 },
  th: { backgroundColor: "#f5f5f4", fontWeight: 700, fontSize: 8 },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: BORDER },
  cell: { padding: 6 },
  right: { textAlign: "right" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    marginTop: 4,
  },
  footer: { position: "absolute", bottom: 28, left: 36, right: 36, fontSize: 7, color: MUTED, textAlign: "center" },
});

function Party({ title, party }: { title: string; party: InvoiceParty }) {
  return (
    <View style={[styles.box, { flex: 1 }]}>
      <Text style={styles.label}>{title}</Text>
      <Text style={styles.bold}>{party.name}</Text>
      {party.addressLines.map((line) => (
        <Text key={line}>{line}</Text>
      ))}
      <Text>
        State: {party.stateName} ({party.stateCode})
      </Text>
      <Text>GSTIN: {party.gstin ?? "Unregistered"}</Text>
      {party.email ? <Text style={styles.muted}>{party.email}</Text> : null}
    </View>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={[styles.between, { gap: 8 }]}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={[styles.bold, { flexShrink: 1, textAlign: "right" }]}>{value}</Text>
    </View>
  );
}

/** Splits long ids over lines; Razorpay's 18-character ids stay on one line. */
function breakable(value: string): string {
  return (value.match(/.{1,22}/g) ?? [value]).join("\n");
}

function money(value: number): string {
  return formatINR(paise(value));
}

/** A GST tax invoice with every field CGST Rule 46 asks for. Rendered once from the stored snapshot. */
export function InvoiceDocument({ invoice }: { invoice: InvoiceRow }) {
  const halfRate = formatRate(invoice.taxRateBps / 2);
  const intraState = invoice.supplyType === "intra-state";
  const stateTaxLabel = invoice.utgstPaise > 0 ? "UTGST" : "SGST";
  const invoiceDate = formatDateIST(istDateStringToDate(invoice.invoiceDate));

  return (
    <Document
      title={`Tax Invoice ${invoice.invoiceNumber}`}
      author={invoice.seller.name}
      subject="Tax Invoice"
      creator={site.brand.name}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.between}>
          <View style={{ maxWidth: 300 }}>
            <Text style={styles.sellerName}>{invoice.seller.name}</Text>
            {invoice.seller.addressLines.map((line) => (
              <Text key={line} style={styles.muted}>
                {line}
              </Text>
            ))}
            <Text style={styles.muted}>
              {invoice.seller.stateName} ({invoice.seller.stateCode})
            </Text>
            <Text>GSTIN: {invoice.seller.gstin}</Text>
            {invoice.seller.email ? <Text style={styles.muted}>{invoice.seller.email}</Text> : null}
          </View>
          <View>
            <Text style={styles.title}>Tax Invoice</Text>
            <Text style={styles.subtitle}>Original for recipient</Text>
          </View>
        </View>

        <View style={[styles.row, { marginTop: 18, gap: 10 }]}>
          <Party title="Bill to" party={invoice.buyer} />
          <View style={[styles.box, { flex: 1, gap: 2 }]}>
            <Meta label="Invoice no." value={invoice.invoiceNumber} />
            <Meta label="Invoice date" value={invoiceDate} />
            <Meta label="Place of supply" value={`${invoice.buyer.stateName} (${invoice.placeOfSupplyStateCode})`} />
            <Meta label="Reverse charge" value="No" />
            <Meta label="Payment ref." value={breakable(invoice.providerPaymentId)} />
          </View>
        </View>

        <View style={styles.table}>
          <View style={[styles.tr, styles.th]}>
            <Text style={[styles.cell, { width: 24 }]}>#</Text>
            <Text style={[styles.cell, { flex: 1 }]}>Description</Text>
            <Text style={[styles.cell, { width: 56 }]}>SAC</Text>
            <Text style={[styles.cell, { width: 32 }, styles.right]}>Qty</Text>
            <Text style={[styles.cell, { width: 90 }, styles.right]}>Taxable value</Text>
          </View>
          {invoice.lineItems.map((item, index) => (
            <View
              key={item.description}
              style={[styles.tr, { borderBottomWidth: index === invoice.lineItems.length - 1 ? 0 : 1 }]}
            >
              <Text style={[styles.cell, { width: 24 }]}>{index + 1}</Text>
              <Text style={[styles.cell, { flex: 1 }]}>{item.description}</Text>
              <Text style={[styles.cell, { width: 56 }]}>{item.sacCode}</Text>
              <Text style={[styles.cell, { width: 32 }, styles.right]}>{item.quantity}</Text>
              <Text style={[styles.cell, { width: 90 }, styles.right]}>{money(item.taxablePaise)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.row}>
          <View style={{ flex: 1 }} />
          <View style={{ width: 230, marginTop: 10 }}>
            <View style={styles.totalRow}>
              <Text>Taxable value</Text>
              <Text>{money(invoice.taxablePaise)}</Text>
            </View>
            {intraState ? (
              <>
                <View style={styles.totalRow}>
                  <Text>CGST @ {halfRate}</Text>
                  <Text>{money(invoice.cgstPaise)}</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text>
                    {stateTaxLabel} @ {halfRate}
                  </Text>
                  <Text>{money(invoice.sgstPaise + invoice.utgstPaise)}</Text>
                </View>
              </>
            ) : (
              <View style={styles.totalRow}>
                <Text>IGST @ {formatRate(invoice.taxRateBps)}</Text>
                <Text>{money(invoice.igstPaise)}</Text>
              </View>
            )}
            <View style={styles.grandTotal}>
              <Text style={styles.bold}>Total</Text>
              <Text style={styles.bold}>{money(invoice.totalPaise)}</Text>
            </View>
          </View>
        </View>

        <View style={[styles.box, { marginTop: 12 }]}>
          <Text style={styles.label}>Total in words</Text>
          <Text style={styles.bold}>{amountInWords(paise(invoice.totalPaise))}</Text>
        </View>

        <Text style={[styles.muted, { marginTop: 12 }]}>
          Paid in full. {intraState ? "Intra-state supply" : "Inter-state supply"}; tax charged at{" "}
          {formatRate(invoice.taxRateBps)}.
        </Text>

        <Text style={styles.footer} fixed>
          {site.invoice.footerNote}
          {site.company.cin ? ` · CIN ${site.company.cin}` : ""}
        </Text>
      </Page>
    </Document>
  );
}
