import { createClient } from "@sample/api-client";
import { charge } from "@sample/payments";
import { theme } from "@sample/ui";
import { startSession } from "./auth/session";

export function bootstrap() {
  const client = createClient();
  const session = startSession();
  return { client, theme, session, charge };
}
