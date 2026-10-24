import { site } from "@/config/site";

/** Injects the brand colours from `src/config/site.ts` as CSS variables (values are zod-validated hex). */
export function BrandStyles() {
  const { light, dark } = site.brand.colors;
  const css = `:root{--primary:${light.primary};--primary-foreground:${light.primaryForeground};--ring:${light.primary}}.dark{--primary:${dark.primary};--primary-foreground:${dark.primaryForeground};--ring:${dark.primary}}`;
  return <style>{css}</style>;
}
