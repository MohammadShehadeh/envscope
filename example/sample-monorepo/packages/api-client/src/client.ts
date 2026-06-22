export function createClient() {
  const baseUrl = process.env.API_URL;
  const timeout = process.env["API_TIMEOUT"]; // element-access form
  return { baseUrl, timeout };
}
