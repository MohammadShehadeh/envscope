/**
 * Shared type definitions for envscope.
 */

/** A workspace package (an app or an internal library). */
export interface Pkg {
  /** package.json "name", or a synthesized name for unnamed roots. */
  name: string;
  /** Absolute, normalized (forward-slash) directory of the package. */
  dir: string;
  /** Path relative to the repo root, e.g. "apps/web". "." for the root itself. */
  relDir: string;
  /** Whether we classify this package as a deployable app vs an internal library. */
  kind: "app" | "lib";
  /** Parsed package.json contents (may be {} for an implicit single-repo app). */
  manifest: PackageManifest;
}

export interface PackageManifest {
  name?: string;
  main?: string;
  module?: string;
  source?: string;
  types?: string;
  typings?: string;
  exports?: unknown;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  [k: string]: unknown;
}

/** How an env var reference was discovered in source. */
export type EnvPattern =
  | "process.env"
  | "import.meta.env"
  | "env-wrapper";

/** A single env-var reference found in a source file. */
export interface EnvUsage {
  /** Env var name, e.g. "STRIPE_SECRET". */
  name: string;
  /** Absolute, normalized file path where it was used. */
  file: string;
  /** Path relative to repo root. */
  relFile: string;
  /** Name of the package that owns the file. */
  pkg: string;
  line: number;
  column: number;
  pattern: EnvPattern;
}

/** Aggregated info for one env var within one app. */
export interface AppEnvVar {
  name: string;
  usages: EnvUsage[];
  /** Distinct packages (by name) in which this var is used for this app. */
  packages: string[];
}

/** Schema diff status for an app's env vars. */
export interface SchemaDiff {
  /** Used in code but not present in the schema. */
  usedButUndefined: string[];
  /** Present in the schema but never used by this app. */
  definedButUnused: string[];
  /** Absolute path of the schema file consulted (if any). */
  schemaFile?: string;
}

/** Full analysis for a single app. */
export interface AppAnalysis {
  app: Pkg;
  /** Source files reachable from this app through its dependency graph. */
  reachableFiles: string[];
  /** Internal packages (names) reachable from this app, including itself. */
  reachablePackages: string[];
  /** Env vars required by this app, sorted by name. */
  envVars: AppEnvVar[];
  schema?: SchemaDiff;
}

/** Result of analyzing the whole repo. */
export interface RepoAnalysis {
  root: string;
  isMonorepo: boolean;
  packages: Pkg[];
  apps: AppAnalysis[];
  /** Env vars used by more than one app: name -> app relDirs. */
  shared: Record<string, string[]>;
}

/** A reverse-lookup chain: how an env var reaches an app. */
export interface FindChain {
  app: Pkg;
  /** Human-readable chain, e.g. ["apps/web", "packages/payments", "stripe.ts"]. */
  chain: string[];
  /** The concrete usage at the end of the chain. */
  usage: EnvUsage;
}
