import { Text } from "react-email";
import { site } from "@/config/site";
import { EmailLayout, emailText } from "./layout";

export type WaitlistConfirmationProps = { name: string };

export function WaitlistConfirmationEmail({ name }: WaitlistConfirmationProps) {
  return (
    <EmailLayout preview={`You're on the ${site.brand.name} waitlist`}>
      <Text style={emailText.heading}>You&apos;re on the list, {name}!</Text>
      <Text style={emailText.paragraph}>
        Thanks for joining the {site.brand.name} waitlist. We&apos;ll email you as soon as early access opens, with your
        launch discount.
      </Text>
      <Text style={emailText.paragraph}>
        Razorpay subscriptions, GST invoices and OTP login, ready on day one. We can&apos;t wait to see what you build.
      </Text>
      <Text style={emailText.muted}>
        You received this because you signed up at our website. Reply &quot;remove&quot; to be taken off the list.
      </Text>
    </EmailLayout>
  );
}

WaitlistConfirmationEmail.PreviewProps = { name: "Aarav" } satisfies WaitlistConfirmationProps;

// React Email's preview server (`pnpm email:dev`) needs a default export.
export default WaitlistConfirmationEmail;
