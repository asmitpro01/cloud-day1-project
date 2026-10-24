import { invoiceFileName } from "@/lib/invoice-number";
import { getCurrentUser } from "@/server/auth/session";
import { ensureInvoicePdf, getInvoice } from "@/server/invoices/store";

/** Invoice PDF download. Only the invoice's owner or an admin may fetch it. */
export async function GET(_request: Request, context: RouteContext<"/api/invoices/[id]/pdf">) {
  const { id } = await context.params;
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const invoice = /^[0-9a-f-]{36}$/i.test(id) ? await getInvoice(id) : null;
  // Same 404 for "missing" and "not yours", so invoice ids can't be probed.
  if (!invoice || (invoice.userId !== user.id && !user.isAdmin)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const pdf = await ensureInvoicePdf(invoice);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoiceFileName(invoice.invoiceNumber)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
