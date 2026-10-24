import { ImageResponse } from "next/og";
import { site } from "@/config/site";

export const alt = site.brand.name;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social preview card for WhatsApp, X and LinkedIn shares. Rendered at build time. */
export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: "#0c0a09",
        color: "#fafaf9",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 40, fontWeight: 700 }}>
        <div style={{ width: 64, height: 64, borderRadius: 14, background: site.brand.colors.light.primary }} />
        {site.brand.name}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.05 }}>Launch your Indian SaaS this weekend</div>
        <div style={{ fontSize: 32, color: "#d6d3d1" }}>Razorpay subscriptions · GST invoices · OTP login</div>
      </div>
    </div>,
    size,
  );
}
