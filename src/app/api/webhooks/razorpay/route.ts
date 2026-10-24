import { after } from "next/server";
import { runBillingFollowUps } from "@/server/billing/follow-up-runner";
import { handleWebhookEvent } from "@/server/billing/webhooks";
import { logger } from "@/server/logger";
import { getPaymentProvider } from "@/server/providers/payments";

/**
 * Razorpay webhooks. The signature is an HMAC-SHA256 of the exact raw body, so the body is read
 * as text and verified before it is parsed. Idempotent per `x-razorpay-event-id`.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const provider = getPaymentProvider();
  if (!provider) return Response.json({ error: "Payments are not configured" }, { status: 404 });

  if (!provider.verifyWebhookSignature(rawBody, request.headers.get("x-razorpay-signature"))) {
    logger.warn("Rejected webhook with an invalid signature");
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  const eventId = request.headers.get("x-razorpay-event-id");
  if (!eventId) return Response.json({ error: "Missing x-razorpay-event-id" }, { status: 400 });

  try {
    const event = provider.parseWebhook(rawBody);
    const result = await handleWebhookEvent({ provider, eventId, event });
    // Respond fast (Razorpay times out after a few seconds); email invoices after the response.
    if (result.followUps.length > 0) after(() => runBillingFollowUps(result.followUps));
    return Response.json({ received: true, duplicate: result.duplicate });
  } catch (error) {
    // A 5xx makes Razorpay retry later; the transaction rolled back, so the retry starts clean.
    logger.error("Webhook processing failed", { error, eventId });
    return Response.json({ error: "Processing failed" }, { status: 500 });
  }
}
