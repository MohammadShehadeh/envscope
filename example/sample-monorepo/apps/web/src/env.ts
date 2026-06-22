// A tiny "typed env wrapper" (t3-env style). Other files import `env` and read
// env.SESSION_TTL / env.PORT; envscope detects those as env-wrapper usages.
export const env = {
  SESSION_TTL: process.env.SESSION_TTL ?? "3600",
  PORT: process.env.PORT ?? "3000",
};
