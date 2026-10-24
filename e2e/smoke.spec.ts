import { expect, test, type Page } from "@playwright/test";
import { findEmail, findSubscription, randomIndianMobile, readAttachment, readOtp, renewalWebhook } from "./helpers";

/** Navigates and waits until client JS has loaded, so clicks reach hydrated React handlers. */
async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

test("sign up with OTP → buy a plan (test mode) → GST invoice generated and emailed", async ({ page, request }) => {
  const mobile = randomIndianMobile();
  const email = `e2e-${mobile}@example.com`;

  await test.step("sign up with phone OTP after giving consent", async () => {
    await open(page, "/sign-up");
    await page.getByLabel(/I agree to the/).check();
    await page.getByLabel("Mobile number").fill(mobile);
    const sentAt = Date.now();
    await page.getByRole("button", { name: "Send OTP" }).click();
    const code = await readOtp(mobile, sentAt - 1000);
    await page.getByLabel(/Enter the 6-digit code/).fill(code);
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText("Add your email")).toBeVisible();
  });

  await test.step("add an email and billing details (Karnataka buyer)", async () => {
    await open(page, "/dashboard/settings");
    await page.getByLabel("Email for invoices").fill(email);
    await page.getByRole("button", { name: "Add email" }).click();
    await expect(page.getByText(`Check ${email} for a verification link`)).toBeVisible();

    await page.getByLabel("Name on invoice").fill("E2E Buyer");
    await page.getByLabel("Address", { exact: true }).fill("1 Residency Road");
    await page.getByLabel("City").fill("Bengaluru");
    await page.getByLabel("PIN code").fill("560025");
    await page.getByLabel("State (place of supply)").selectOption("29");
    await page.getByRole("button", { name: "Save billing details" }).click();
    await expect(page.getByText("Billing details saved")).toBeVisible();
  });

  let invoiceNumber = "";
  await test.step("subscribe to Pro with the test checkout", async () => {
    await open(page, "/dashboard/billing");
    await page.getByRole("button", { name: "Subscribe to Pro" }).click();
    await page.getByRole("button", { name: "Simulate successful payment" }).click();
    await expect(page.getByText(/Next charge on/)).toBeVisible();
    const invoiceLink = page.getByRole("link", { name: /^INV\/\d{4}\/\d+$/ }).first();
    await expect(invoiceLink).toBeVisible();
    invoiceNumber = (await invoiceLink.textContent()) ?? "";

    // page.request shares the signed-in browser's cookies.
    const pdf = await page.request.get((await invoiceLink.getAttribute("href")) ?? "");
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  await test.step("invoice email arrives with the PDF attached", async () => {
    const message = await findEmail((candidate) => candidate.to === email && candidate.subject.includes(invoiceNumber));
    const fileName = `${invoiceNumber.replaceAll("/", "-")}.pdf`;
    expect(message.attachments).toEqual([fileName]);
    expect((await readAttachment(message, fileName)).subarray(0, 5).toString()).toBe("%PDF-");
  });

  await test.step("a signed renewal webhook issues the next invoice; a replay is ignored", async () => {
    const subscription = await findSubscription(email);
    const webhook = renewalWebhook({
      subscriptionId: subscription.providerSubscriptionId,
      planId: subscription.providerPlanId,
      amountPaise: 49_900,
    });
    const send = () =>
      request.post("/api/webhooks/razorpay", {
        data: webhook.body,
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": webhook.signature,
          "x-razorpay-event-id": webhook.eventId,
        },
      });
    expect(await (await send()).json()).toEqual({ received: true, duplicate: false });
    expect(await (await send()).json()).toEqual({ received: true, duplicate: true });

    const forged = await request.post("/api/webhooks/razorpay", {
      data: webhook.body,
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": "0".repeat(64),
        "x-razorpay-event-id": "evt_forged",
      },
    });
    expect(forged.status()).toBe(400);

    await page.reload();
    await expect(page.getByRole("link", { name: /^INV\/\d{4}\/\d+$/ })).toHaveCount(2);
  });
});
