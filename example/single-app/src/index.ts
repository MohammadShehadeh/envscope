import { getDbUrl } from "./config";

export function start() {
  const port = process.env.PORT ?? "8080";
  const db = getDbUrl();
  return { port, db };
}
