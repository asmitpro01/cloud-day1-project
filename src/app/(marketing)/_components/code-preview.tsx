import { cacheLife } from "next/cache";
import { codeToHtml } from "shiki";
import { CODE_SAMPLE } from "../_content";

/** Highlighted on the server and cached into the static shell, so it ships zero client JS. */
async function HighlightedCode() {
  "use cache";
  cacheLife("max");
  const html = await codeToHtml(CODE_SAMPLE, {
    lang: "tsx",
    themes: { light: "github-light", dark: "github-dark" },
  });
  // The HTML comes from shiki rendering our own constant, never from user input.
  return <div className="[&_pre]:min-w-0" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function CodePreview() {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 lg:grid-cols-2">
      <div className="space-y-4">
        <h2 className="text-3xl font-bold tracking-tight">Typed, tested, readable</h2>
        <p className="text-lg text-muted-foreground">
          Strict TypeScript, money as integer paise and every provider behind an adapter. Read it in an afternoon,
          change it with confidence.
        </p>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>✓ Unit tests for GST maths, GSTIN checksums, FY rollover and rounding</li>
          <li>✓ Concurrency-safe invoice numbering tested against real Postgres</li>
          <li>✓ Playwright smoke test from signup to invoice email</li>
        </ul>
      </div>
      <div className="min-w-0 rounded-xl border bg-card shadow-sm">
        <div className="flex items-center gap-1.5 border-b px-4 py-3" aria-hidden>
          <span className="size-2.5 rounded-full bg-red-400" />
          <span className="size-2.5 rounded-full bg-amber-400" />
          <span className="size-2.5 rounded-full bg-green-400" />
          <span className="ml-2 font-mono text-xs text-muted-foreground">app/dashboard/reports/page.tsx</span>
        </div>
        <HighlightedCode />
      </div>
    </section>
  );
}
