import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getAuthMethods } from "@/server/auth/methods";
import { AuthCard, AuthCardSkeleton } from "../_components/auth-card";
import { SignUpMethods } from "../_components/sign-up-methods";

export const metadata: Metadata = { title: "Create your account" };

async function Methods() {
  await connection();
  const methods = getAuthMethods();
  return <SignUpMethods phone={methods.phone} google={methods.google} />;
}

export default function SignUpPage() {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <AuthCard
        title="Create your account"
        description="Start with your mobile number, email or Google."
        footer={
          <>
            Already have an account?{" "}
            <Link href="/sign-in" className="text-foreground underline underline-offset-4">
              Sign in
            </Link>
          </>
        }
      >
        <Methods />
      </AuthCard>
    </Suspense>
  );
}
