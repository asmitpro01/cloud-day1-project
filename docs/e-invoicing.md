# E-invoicing (IRN): future extension

**Status:** not implemented. `src/server/invoices/e-invoicing.ts` holds the interface and a
`requiresEInvoice()` helper so it can be added without touching the rest of billing.

> This page is orientation, not tax advice. Thresholds and schemas change; confirm with your CA.

## Do you need it?

E-invoicing applies to **B2B** invoices (the buyer has a GSTIN) issued by businesses whose
aggregate annual turnover in any financial year since 2017-18 exceeds the notified threshold
(₹5 crore since 1 August 2023). B2C invoices don't need an IRN. Most early-stage SaaS businesses
built on this kit are below the threshold.

## How it works

1. Your app builds the invoice JSON in the GSTN **INV-01** schema.
2. It sends the JSON to the **Invoice Registration Portal (IRP)**, directly with API access or,
   more commonly, through a **GSP** (GST Suvidha Provider) such as ClearTax, Masters India or IRIS.
3. The IRP validates it and returns an **IRN** (a 64-character hash), an acknowledgement number
   and date, and a **signed QR code**.
4. The invoice must show the IRN and QR code. An IRN can only be cancelled within 24 hours.

## Where to plug it in

- Implement `EInvoiceProvider` for your GSP in `src/server/invoices/e-invoicing/<gsp>.ts`.
- After `createInvoiceForPayment()` commits, if `requiresEInvoice(invoice, { enabled: true })`,
  call `generateIrn()` and store the result in new columns on `invoices`
  (`irn`, `irn_ack_no`, `irn_ack_date`, `signed_qr_code`); add a migration with `pnpm db:generate`.
- Render the IRN and QR on the PDF in `src/server/invoices/pdf/invoice-document.tsx`.
  Generate the PDF **after** the IRN exists. PDFs are stored once, so delay `ensureInvoicePdf()`
  until the IRN call succeeds.
- Retry failed IRP calls from a background job; the invoice number is already final.
