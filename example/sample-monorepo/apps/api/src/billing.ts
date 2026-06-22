import { charge } from "@sample/payments";

export function handleBilling() {
  const webhook = process.env.BILLING_WEBHOOK_SECRET;
  charge(100);
  return { webhook };
}
