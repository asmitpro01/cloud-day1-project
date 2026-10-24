import type { MetadataRoute } from "next";
import { clientEnv } from "@/env/client";

const PUBLIC_PATHS = [
  "/",
  "/legal/terms",
  "/legal/privacy",
  "/legal/refunds",
  "/legal/shipping",
  "/contact",
  "/sign-in",
  "/sign-up",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({ url: `${clientEnv.appUrl}${path === "/" ? "" : path}` }));
}
