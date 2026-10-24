import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard, AuthCardSkeleton } from "../_components/auth-card";
import { ResetPasswordForm } from "../_components/reset-password-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <AuthCard title="Choose a new password" description="Use at least 8 characters.">
        <ResetPasswordForm />
      </AuthCard>
    </Suspense>
  );
}
