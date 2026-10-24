import "server-only";
import path from "node:path";
import { Font } from "@react-pdf/renderer";

export const PDF_FONT_FAMILY = "Noto Sans";

let registered = false;

/**
 * Registers Noto Sans (SIL OFL), which has the ₹ glyph that the built-in Helvetica lacks.
 * Files live in assets/fonts and are bundled via `outputFileTracingIncludes` in next.config.ts.
 */
export function registerPdfFonts(): void {
  if (registered) return;
  const dir = path.join(process.cwd(), "assets", "fonts");
  Font.register({
    family: PDF_FONT_FAMILY,
    fonts: [
      { src: path.join(dir, "NotoSans-Regular.ttf"), fontWeight: 400 },
      { src: path.join(dir, "NotoSans-Bold.ttf"), fontWeight: 700 },
    ],
  });
  // Invoice text must never be split with hyphens.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
