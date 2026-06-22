import { describe, it, expect } from "vitest";
import path from "node:path";
import { analyzeRepo, findEnvVar } from "../src/analyze";

const MONO = path.resolve(__dirname, "../example/sample-monorepo");
const SINGLE = path.resolve(__dirname, "../example/single-app");

function appByDir(result: ReturnType<typeof analyzeRepo>, relDir: string) {
  const app = result.analysis.apps.find((a) => a.app.relDir === relDir);
  if (!app) throw new Error(`app ${relDir} not found`);
  return app;
}
function names(app: ReturnType<typeof appByDir>) {
  return app.envVars.map((v) => v.name).sort();
}

describe("monorepo analysis", () => {
  const result = analyzeRepo(MONO);

  it("detects a monorepo with two apps", () => {
    expect(result.analysis.isMonorepo).toBe(true);
    const appDirs = result.analysis.apps.map((a) => a.app.relDir).sort();
    expect(appDirs).toEqual(["apps/api", "apps/web"]);
  });

  it("attributes env vars to apps/web through its dependency graph", () => {
    const web = appByDir(result, "apps/web");
    const n = names(web);
    // own + api-client + payments + ui (import.meta) + env-wrapper
    expect(n).toContain("API_URL");
    expect(n).toContain("API_TIMEOUT");
    expect(n).toContain("STRIPE_SECRET");
    expect(n).toContain("STRIPE_WEBHOOK_SECRET");
    expect(n).toContain("AUTH_SECRET");
    expect(n).toContain("NEXTAUTH_URL");
    expect(n).toContain("SESSION_TTL"); // env-wrapper
    expect(n).toContain("PORT");
    expect(n).toContain("VITE_THEME"); // import.meta.env via @sample/ui
    // db is NOT a dependency of web -> must not leak in
    expect(n).not.toContain("DATABASE_URL");
    expect(n).not.toContain("BILLING_WEBHOOK_SECRET");
  });

  it("attributes env vars to apps/api through its dependency graph", () => {
    const api = appByDir(result, "apps/api");
    const n = names(api);
    expect(n).toContain("DATABASE_URL");
    expect(n).toContain("STRIPE_SECRET");
    expect(n).toContain("STRIPE_WEBHOOK_SECRET");
    expect(n).toContain("BILLING_WEBHOOK_SECRET");
    expect(n).toContain("PORT");
    // ui / api-client are NOT dependencies of api
    expect(n).not.toContain("VITE_THEME");
    expect(n).not.toContain("API_URL");
  });

  it("maps env vars to their real file locations", () => {
    const web = appByDir(result, "apps/web");
    const apiUrl = web.envVars.find((v) => v.name === "API_URL")!;
    expect(apiUrl.usages[0].relFile.replace(/\\/g, "/")).toBe(
      "packages/api-client/src/client.ts",
    );
  });

  it("computes shared env vars across apps", () => {
    expect(Object.keys(result.analysis.shared).sort()).toEqual(
      expect.arrayContaining(["PORT", "STRIPE_SECRET", "STRIPE_WEBHOOK_SECRET"]),
    );
    expect(result.analysis.shared.STRIPE_SECRET.sort()).toEqual(["apps/api", "apps/web"]);
    expect(result.analysis.shared.DATABASE_URL).toBeUndefined();
  });

  it("diffs against an .env schema", () => {
    const web = appByDir(result, "apps/web");
    expect(web.schema?.usedButUndefined).toContain("VITE_THEME");
    expect(web.schema?.definedButUnused).toContain("NEXT_PUBLIC_APP_NAME");
  });

  it("reverse-lookup produces app -> package -> file chains", () => {
    const chains = findEnvVar(result, "STRIPE_SECRET");
    const byApp = Object.fromEntries(chains.map((c) => [c.app.relDir, c.chain]));
    expect(byApp["apps/web"]).toEqual(["apps/web", "packages/payments", "stripe.ts"]);
    expect(byApp["apps/api"]).toEqual(["apps/api", "packages/payments", "stripe.ts"]);
  });
});

describe("single-package repo", () => {
  const result = analyzeRepo(SINGLE);

  it("treats the whole repo as one app", () => {
    expect(result.analysis.isMonorepo).toBe(false);
    expect(result.analysis.apps).toHaveLength(1);
    expect(result.analysis.apps[0].app.name).toBe("single-app");
  });

  it("follows local imports for env attribution", () => {
    const app = result.analysis.apps[0];
    expect(names(app)).toEqual(["DATABASE_URL", "PORT"]);
  });

  it("flags unused schema keys", () => {
    const app = result.analysis.apps[0];
    expect(app.schema?.definedButUnused).toContain("LEGACY_FLAG");
  });
});
