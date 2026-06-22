/**
 * Public programmatic API.
 *
 *   import { analyzeRepo, findEnvVar } from "envscope";
 *   const { analysis } = analyzeRepo(process.cwd());
 */
export { analyzeRepo, findEnvVar } from "./analyze";
export type { AnalyzeOptions, AnalyzeResult } from "./analyze";
export { discoverWorkspace } from "./workspace";
export type { WorkspaceInfo } from "./workspace";
export { DependencyGraph } from "./graph";
export {
  analysisToJson,
  analysisToMarkdown,
  findToJson,
  findToMarkdown,
  renderAnalysisHuman,
  renderFindHuman,
} from "./output";
export * from "./types";
