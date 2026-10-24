import { CodePreview } from "./_components/code-preview";
import { Faq } from "./_components/faq";
import { Features } from "./_components/features";
import { Hero } from "./_components/hero";
import { Pricing } from "./_components/pricing";
import { WaitlistForm } from "./_components/waitlist-form";

export default function LandingPage() {
  return (
    <>
      <Hero />
      <Features />
      <CodePreview />
      <Pricing />
      <Faq />
      <section id="waitlist" className="mx-auto max-w-xl scroll-mt-20 px-4 py-16">
        <div className="mb-8 text-center">
          <h2 className="text-3xl font-bold tracking-tight">Get early access</h2>
          <p className="mt-3 text-muted-foreground">Join the waitlist for launch updates and an early-bird discount.</p>
        </div>
        <WaitlistForm />
      </section>
    </>
  );
}
