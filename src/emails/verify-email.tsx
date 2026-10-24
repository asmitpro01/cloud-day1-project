import { Button, Text } from "react-email";
import { site } from "@/config/site";
import { EmailLayout, emailText } from "./layout";

export type VerifyEmailProps = { name: string; url: string };

export function VerifyEmail({ name, url }: VerifyEmailProps) {
  return (
    <EmailLayout preview={`Confirm your email for ${site.brand.name}`}>
      <Text style={emailText.heading}>Confirm your email</Text>
      <Text style={emailText.paragraph}>
        Hi {name}, please confirm this email address so we can send you invoices and account notices.
      </Text>
      <Button href={url} style={emailText.button}>
        Confirm email
      </Button>
      <Text style={{ ...emailText.muted, marginTop: "24px" }}>
        This link expires in 1 hour. If you didn&apos;t create an account, you can ignore this email.
      </Text>
    </EmailLayout>
  );
}

VerifyEmail.PreviewProps = { name: "Aarav", url: "https://example.com/verify" } satisfies VerifyEmailProps;

export default VerifyEmail;
