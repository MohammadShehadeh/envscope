import { connect } from "@sample/db";
import { handleBilling } from "./billing";

export function main() {
  connect();
  handleBilling();
  const port = process.env.PORT;
  return { port };
}
