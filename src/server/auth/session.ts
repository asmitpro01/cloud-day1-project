import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { serverEnv } from "@/env/server";
import { getAuth } from "./auth";
import { isPlaceholderEmail } from "./placeholder-email";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  /** False for phone-only accounts that still have the placeholder email. */
  hasRealEmail: boolean;
  phoneNumber: string | null;
  isAdmin: boolean;
};

/**
 * The current session, read once per request (React `cache`). The request headers are read
 * before the auth instance so prerendering stops at the request boundary, not at env validation.
 */
export const getCurrentSession = cache(async () => {
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
});

/** The signed-in user, or `null`. Use in server actions and route handlers. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getCurrentSession();
  if (!session) return null;
  const { user } = session;
  const adminByEmail = user.emailVerified && serverEnv().adminEmails.has(user.email.toLowerCase());
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    hasRealEmail: !isPlaceholderEmail(user.email),
    phoneNumber: user.phoneNumber ?? null,
    isAdmin: user.role === "admin" || adminByEmail,
  };
}

/** The signed-in user; redirects to sign-in otherwise. Use in pages and layouts. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

/** An admin user; anyone else gets a 404 so the admin area isn't discoverable. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.isAdmin) notFound();
  return user;
}
