import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { BrandStyles } from "@/components/brand-styles";
import { ThemeProvider } from "@/components/theme-provider";
import { site } from "@/config/site";
import { clientEnv } from "@/env/client";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(clientEnv.appUrl),
  title: { default: `${site.brand.name} | ${site.brand.tagline}`, template: `%s | ${site.brand.name}` },
  description: site.brand.description,
  openGraph: {
    type: "website",
    siteName: site.brand.name,
    title: site.brand.name,
    description: site.brand.description,
    locale: "en_IN",
  },
  twitter: { card: "summary_large_image", title: site.brand.name, description: site.brand.description },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0a09" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en-IN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <BrandStyles />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
