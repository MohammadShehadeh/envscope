import { env } from "../env";

export function startSession() {
  const secret = process.env.AUTH_SECRET;
  const url = process.env.NEXTAUTH_URL;
  const ttl = env.SESSION_TTL; // env-wrapper pattern
  return { secret, url, ttl };
}
