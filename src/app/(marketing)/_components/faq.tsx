import { ChevronDownIcon } from "lucide-react";
import { FAQS } from "../_content";

/** Native <details> keeps the FAQ accessible and JavaScript-free. */
export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-16">
      <h2 className="mb-8 text-center text-3xl font-bold tracking-tight">Frequently asked questions</h2>
      <div className="divide-y rounded-xl border">
        {FAQS.map((faq) => (
          <details key={faq.question} className="group px-6 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
              {faq.question}
              <ChevronDownIcon
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{faq.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
