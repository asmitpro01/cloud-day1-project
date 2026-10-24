import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function FieldError({ id, messages }: { id: string; messages: string[] | undefined }) {
  if (!messages?.length) return null;
  return (
    <p id={id} className="text-sm text-destructive">
      {messages[0]}
    </p>
  );
}

export function ActionMessage({
  result,
}: {
  result:
    { ok: true; data: { message: string } } | { ok: false; error: { message: string; fieldErrors?: unknown } } | null;
}) {
  if (!result) return null;
  if (result.ok) {
    return (
      <p role="status" className="text-sm text-success">
        {result.data.message}
      </p>
    );
  }
  if (result.error.fieldErrors) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {result.error.message}
    </p>
  );
}
