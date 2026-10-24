import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import type { InvoiceRow } from "../create";
import { registerPdfFonts } from "./fonts";
import { InvoiceDocument } from "./invoice-document";

export async function renderInvoicePdf(invoice: InvoiceRow): Promise<Buffer> {
  registerPdfFonts();
  return renderToBuffer(<InvoiceDocument invoice={invoice} />);
}
