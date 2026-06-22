export function charge(amount: number) {
  const key = process.env.STRIPE_SECRET;
  const { STRIPE_WEBHOOK_SECRET } = process.env; // destructuring form
  return { amount, key, STRIPE_WEBHOOK_SECRET };
}
