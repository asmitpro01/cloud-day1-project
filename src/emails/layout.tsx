import type { ReactNode } from "react";
import { Body, Container, Head, Hr, Html, Preview, Section, Text } from "react-email";
import { site } from "@/config/site";

const styles = {
  body: {
    backgroundColor: "#f5f5f4",
    fontFamily: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    margin: 0,
    padding: "24px 0",
  },
  container: { backgroundColor: "#ffffff", borderRadius: "8px", margin: "0 auto", maxWidth: "560px", padding: "32px" },
  brand: { color: site.brand.colors.light.primary, fontSize: "18px", fontWeight: 700, margin: "0 0 24px" },
  footer: { color: "#78716c", fontSize: "12px", lineHeight: "18px", margin: 0 },
} as const;

export const emailText = {
  heading: { color: "#1c1917", fontSize: "22px", fontWeight: 700, lineHeight: "30px", margin: "0 0 16px" },
  paragraph: { color: "#44403c", fontSize: "15px", lineHeight: "24px", margin: "0 0 16px" },
  button: {
    backgroundColor: site.brand.colors.light.primary,
    borderRadius: "6px",
    color: site.brand.colors.light.primaryForeground,
    display: "inline-block",
    fontSize: "15px",
    fontWeight: 600,
    padding: "12px 20px",
    textDecoration: "none",
  },
  muted: { color: "#78716c", fontSize: "13px", lineHeight: "20px", margin: "0 0 12px" },
} as const;

/** Shared shell for every transactional email: brand header, content and legal footer. */
export function EmailLayout({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Text style={styles.brand}>{site.brand.name}</Text>
          <Section>{children}</Section>
          <Hr style={{ borderColor: "#e7e5e4", margin: "24px 0" }} />
          <Text style={styles.footer}>
            {site.company.legalName}, {site.company.address.city}. Questions? Reply to this email or write to{" "}
            {site.brand.supportEmail}.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
