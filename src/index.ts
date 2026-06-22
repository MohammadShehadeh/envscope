/**
 * Public programmatic API.
 *
 *   import { analyzeRepo, findEnvVar } from "envscope";
 *   const { analysis } = analyzeRepo(process.cwd());
 */
export { analyzeRepo, findEnvVar } from "./analyze";
export type { AnalyzeOptions, AnalyzeResult } from "./analyze";
export * from "./types";
