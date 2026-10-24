import { Button, Text } from "react-email";
import { site } from "@/config/site";
import { EmailLayout, emailText } from "./layout";

export type ResetPasswordEmailProps = { name: string; url: string };

export function ResetPasswordEmail({ name, url }: ResetPasswordEmailProps) {
  return (
    <EmailLayout preview={`Reset your ${site.brand.name} password`}>
      <Text style={emailText.heading}>Reset your password</Text>
      <Text style={emailText.paragraph}>Hi {name}, we received a request to reset your password.</Text>
      <Button href={url} style={emailText.button}>
        Choose a new password
      </Button>
      <Text style={{ ...emailText.muted, marginTop: "24px" }}>
        This link expires in 1 hour. If you didn&apos;t ask for this, ignore this email; your password won&apos;t
        change.
      </Text>
    </EmailLayout>
  );
}

ResetPasswordEmail.PreviewProps = { name: "Aarav", url: "https://example.com/reset" } satisfies ResetPasswordEmailProps;

export default ResetPasswordEmail;
