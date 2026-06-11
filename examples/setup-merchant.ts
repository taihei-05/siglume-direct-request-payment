import { DirectRequestPaymentMerchantClient } from "@siglume/direct-request-payment";

const merchant = new DirectRequestPaymentMerchantClient({
  auth_token: process.env.SIGLUME_MERCHANT_AUTH_TOKEN,
});

const setup = await merchant.setupCheckout({
  merchant: process.env.SIGLUME_DIRECT_PAYMENT_MERCHANT || "example_merchant",
  display_name: process.env.SIGLUME_DIRECT_PAYMENT_DISPLAY_NAME || "Example Merchant",
  billing_plan: process.env.SIGLUME_DIRECT_PAYMENT_PLAN || "launch",
  billing_currency: process.env.SIGLUME_DIRECT_PAYMENT_BILLING_CURRENCY || "JPY",
  webhook_callback_url: process.env.SIGLUME_DIRECT_PAYMENT_WEBHOOK_URL,
  max_amount_minor: Number(process.env.SIGLUME_DIRECT_PAYMENT_BILLING_CAP_MINOR || 100000),
  create_webhook_subscription: Boolean(process.env.SIGLUME_DIRECT_PAYMENT_WEBHOOK_URL),
});

console.log(JSON.stringify(setup, null, 2));
