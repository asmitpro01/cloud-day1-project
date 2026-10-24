import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getAuthMethods } from "@/server/auth/methods";
import { AuthCard, AuthCardSkeleton } from "../_components/auth-card";
import { SignInMethods } from "../_components/sign-in-methods";

export const metadata: Metadata = { title: "Sign in" };

async function Methods() {
  // Read configured methods at request time so builds don't need runtime secrets.
  await connection();
  const methods = getAuthMethods();
  return <SignInMethods phone={methods.phone} google={methods.google} />;
}

export default function SignInPage() {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <AuthCard
        title="Welcome back"
        description="Sign in with your mobile number or email."
        footer={
          <>
            New here?{" "}
            <Link href="/sign-up" className="text-foreground underline underline-offset-4">
              Create an account
            </Link>
          </>
        }
      >
        <Methods />
      </AuthCard>
    </Suspense>
  );
}
