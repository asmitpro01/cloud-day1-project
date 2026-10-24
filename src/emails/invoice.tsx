import { Section, Text } from "react-email";
import { site } from "@/config/site";
import { EmailLayout, emailText } from "./layout";

export type InvoiceEmailProps = {
  name: string;
  invoiceNumber: string;
  invoiceDate: string;
  total: string;
  description: string;
};

export function InvoiceEmail({ name, invoiceNumber, invoiceDate, total, description }: InvoiceEmailProps) {
  return (
    <EmailLayout preview={`Tax invoice ${invoiceNumber} for ${total}`}>
      <Text style={emailText.heading}>Thanks for your payment</Text>
      <Text style={emailText.paragraph}>
        Hi {name}, we&apos;ve received {total}. Your GST tax invoice is attached as a PDF and is always available from
        the Billing page.
      </Text>
      <Section style={{ backgroundColor: "#fafaf9", borderRadius: "6px", padding: "12px 16px", margin: "0 0 16px" }}>
        <Text style={{ ...emailText.muted, margin: 0 }}>
          Invoice {invoiceNumber} · {invoiceDate}
        </Text>
        <Text style={{ ...emailText.paragraph, margin: "4px 0 0" }}>{description}</Text>
        <Text style={{ ...emailText.paragraph, fontWeight: 700, margin: "4px 0 0" }}>Total paid: {total}</Text>
      </Section>
      <Text style={emailText.muted}>
        Need a different billing name, address or GSTIN on future invoices? Update it in Settings. Questions? Write to{" "}
        {site.brand.supportEmail}.
      </Text>
    </EmailLayout>
  );
}

InvoiceEmail.PreviewProps = {
  name: "Aarav",
  invoiceNumber: "INV/2627/000042",
  invoiceDate: "24 Oct 2026",
  total: "₹499.00",
  description: "Pro plan (monthly)",
} satisfies InvoiceEmailProps;

export default InvoiceEmail;
