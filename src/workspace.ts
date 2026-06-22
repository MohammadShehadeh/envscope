/**
 * Workspace / repo discovery.
 *
 * Works for two shapes:
 *   1. A monorepo (pnpm / yarn / npm workspaces, Nx, Turborepo, or the bare
 *      `apps/* + packages/*` folder convention) -> many packages, several apps.
 *   2. A plain single-package repo -> exactly one "app" rooted at the repo dir.
 *
 * The rest of the tool does not care which one it is: it only consumes the
 * resulting list of packages and the per-app dependency graph.
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { Pkg, PackageManifest } from "./types";
import { norm, relFrom, IGNORED_DIRS } from "./paths";

const APP_DIR_PREFIXES = ["apps/", "app/", "services/", "sites/", "examples/"];
const LIB_DIR_PREFIXES = [
  "packages/",
  "libs/",
  "lib/",
  "internal/",
  "tooling/",
  "tools/",
  "config/",
  "configs/",
  "shared/",
];

export interface WorkspaceInfo {
  root: string;
  isMonorepo: boolean;
  /** Short label describing how the workspace was detected. */
  manager: string;
  packages: Pkg[];
}

function readJson(file: string): PackageManifest | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as PackageManifest;
  } catch {
    return null;
  }
}

/** Read declared workspace globs from the various config files. */
function detectPatterns(root: string): { patterns: string[]; manager: string } | null {
  const pnpmFile = path.join(root, "pnpm-workspace.yaml");
  if (fs.existsSync(pnpmFile)) {
    try {
      const doc = YAML.parse(fs.readFileSync(pnpmFile, "utf8")) as { packages?: string[] };
      if (Array.isArray(doc?.packages) && doc.packages.length) {
        return { patterns: doc.packages, manager: "pnpm" };
      }
    } catch {
      /* fall through */
    }
  }

  const rootPkg = readJson(path.join(root, "package.json"));
  if (rootPkg?.workspaces) {
    const ws = rootPkg.workspaces as string[] | { packages?: string[] };
    const patterns = Array.isArray(ws) ? ws : ws?.packages;
    if (Array.isArray(patterns) && patterns.length) {
      return { patterns, manager: "npm/yarn workspaces" };
    }
  }

  const lerna = readJson(path.join(root, "lerna.json"));
  if (Array.isArray(lerna?.packages) && (lerna!.packages as string[]).length) {
    return { patterns: lerna!.packages as string[], manager: "lerna" };
  }

  return null;
}

/** Turn a workspace glob like "apps/*" or "packages/**" into a RegExp over relDirs. */
function globToRegExp(glob: string): RegExp {
  const cleaned = glob.replace(/\/+$/, "");
  let re = "";
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c === "*") {
      if (cleaned[i + 1] === "*") {
        re += ".*";
        i++;
        if (cleaned[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if ("\\^$.|?+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

/** Find every directory under root that contains a package.json. */
function findPackageDirs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 8) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === "package.json")) {
      out.push(norm(dir));
    }
    for (const e of entries) {
      if (e.isDirectory() && !IGNORED_DIRS.has(e.name) && !e.name.startsWith(".")) {
        walk(path.join(dir, e.name), depth + 1);
      }
    }
  };
  walk(root, 0);
  return out;
}

function classifyByConvention(relDir: string): "app" | "lib" | null {
  if (APP_DIR_PREFIXES.some((p) => relDir.startsWith(p))) return "app";
  if (LIB_DIR_PREFIXES.some((p) => relDir.startsWith(p))) return "lib";
  return null;
}

function makePkg(root: string, dir: string): Pkg | null {
  const manifest = readJson(path.join(dir, "package.json")) ?? {};
  const relDir = relFrom(root, dir);
  const name =
    manifest.name && manifest.name.trim().length > 0
      ? manifest.name
      : relDir === "."
        ? path.basename(root)
        : relDir;
  return {
    name,
    dir: norm(dir),
    relDir,
    kind: classifyByConvention(relDir) ?? "lib", // refined below
    manifest,
  };
}

/** Names of internal packages that some other internal package depends on. */
function computeConsumed(packages: Pkg[]): Set<string> {
  const names = new Set(packages.map((p) => p.name));
  const consumed = new Set<string>();
  for (const p of packages) {
    const deps = {
      ...p.manifest.dependencies,
      ...p.manifest.devDependencies,
      ...p.manifest.peerDependencies,
      ...p.manifest.optionalDependencies,
    };
    for (const dep of Object.keys(deps)) {
      if (names.has(dep) && dep !== p.name) consumed.add(dep);
    }
  }
  return consumed;
}

/**
 * Discover the repo's packages and classify apps vs libs.
 * `root` should be the repo root (an absolute path).
 */
export function discoverWorkspace(root: string): WorkspaceInfo {
  const absRoot = norm(root);
  const detected = detectPatterns(absRoot);

  let patterns: string[] | null = detected?.patterns ?? null;
  let manager = detected?.manager ?? "single-package";

  // Convention fallback: an `apps/` folder with package.json-bearing subdirs.
  if (!patterns) {
    const appsDir = path.join(absRoot, "apps");
    if (fs.existsSync(appsDir) && fs.statSync(appsDir).isDirectory()) {
      patterns = ["apps/*", "packages/*", "libs/*", "tooling/*"];
      manager = "folder convention";
    }
  }

  let packages: Pkg[] = [];
  let isMonorepo = false;

  if (patterns) {
    const regexes = patterns.map(globToRegExp);
    const dirs = findPackageDirs(absRoot).filter((dir) => {
      const rel = relFrom(absRoot, dir);
      if (rel === ".") return false; // never treat the workspace root as a member
      return regexes.some((re) => re.test(rel));
    });
    packages = dirs.map((d) => makePkg(absRoot, d)).filter((p): p is Pkg => p !== null);
    isMonorepo = packages.length > 1;
  }

  // Single-package repo (or workspace globs that matched nothing usable).
  if (packages.length === 0) {
    const rootPkg = makePkg(absRoot, absRoot);
    if (rootPkg) {
      rootPkg.kind = "app";
      packages = [rootPkg];
    }
    isMonorepo = false;
  }

  // Refine ambiguous classifications using the internal dependency graph:
  // a package nobody else depends on is almost certainly an app.
  if (isMonorepo) {
    const consumed = computeConsumed(packages);
    for (const p of packages) {
      const byConvention = classifyByConvention(p.relDir);
      if (byConvention) {
        p.kind = byConvention;
      } else {
        p.kind = consumed.has(p.name) ? "lib" : "app";
      }
    }
  }

  return { root: absRoot, isMonorepo, manager, packages };
}
