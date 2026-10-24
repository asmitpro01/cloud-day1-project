import type { MetadataRoute } from "next";
import { clientEnv } from "@/env/client";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/dashboard", "/admin", "/api/"] },
    sitemap: `${clientEnv.appUrl}/sitemap.xml`,
  };
}
