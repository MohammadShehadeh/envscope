/**
 * Dependency graph.
 *
 * The whole value of envscope is correct attribution: an env var belongs to an
 * app only if it is reachable through that app's dependency graph. That graph is
 * built here at *file* granularity:
 *
 *   app's own files  --import-->  more files  --import-->  shared package files
 *
 * We resolve two kinds of specifiers ourselves (no tsconfig required, fully
 * deterministic across OSes):
 *   - relative:  "./client", "../foo/bar.js"
 *   - workspace: "@scope/payments", "@scope/payments/stripe"  (internal pkgs)
 * Anything else (a real node_modules dependency) is treated as a leaf.
 */
import path from "node:path";
import type { Pkg } from "./types";
import { norm, SOURCE_EXTENSIONS } from "./paths";

const TS_JS_EXT = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/;

export class DependencyGraph {
  private readonly fileSet: Set<string>;
  private readonly packages: Pkg[];
  /** Packages sorted by dir length desc, for longest-prefix file ownership. */
  private readonly packagesByDirLen: Pkg[];
  /** Workspace package names sorted by length desc, for specifier matching. */
  private readonly namesByLen: { name: string; pkg: Pkg }[];
  /** file -> set of resolved internal files it imports. */
  private readonly edges = new Map<string, Set<string>>();
  private readonly fileOwner = new Map<string, Pkg>();

  constructor(packages: Pkg[], files: string[]) {
    this.packages = packages;
    this.fileSet = new Set(files);
    this.packagesByDirLen = [...packages].sort((a, b) => b.dir.length - a.dir.length);
    this.namesByLen = packages
      .map((pkg) => ({ name: pkg.name, pkg }))
      .sort((a, b) => b.name.length - a.name.length);
    for (const f of files) {
      const owner = this.ownerOf(f);
      if (owner) this.fileOwner.set(f, owner);
    }
  }

  /** Which package owns a file (longest matching directory prefix). */
  ownerOf(file: string): Pkg | undefined {
    if (this.fileOwner.has(file)) return this.fileOwner.get(file);
    for (const pkg of this.packagesByDirLen) {
      if (file === pkg.dir || file.startsWith(pkg.dir + "/")) return pkg;
    }
    return undefined;
  }

  /** All parsed files belonging to a package (its entry surface). */
  filesOf(pkg: Pkg): string[] {
    const out: string[] = [];
    for (const f of this.fileSet) if (this.fileOwner.get(f) === pkg) out.push(f);
    return out;
  }

  /** Record that `from` imports the module string `spec`; adds an edge if internal. */
  addImport(from: string, spec: string): void {
    const target = this.resolve(from, spec);
    if (!target) return;
    let set = this.edges.get(from);
    if (!set) {
      set = new Set();
      this.edges.set(from, set);
    }
    set.add(target);
  }

  private resolveToFile(p: string): string | null {
    const np = norm(p);
    if (this.fileSet.has(np)) return np;
    const base = TS_JS_EXT.test(np) ? np.replace(TS_JS_EXT, "") : np;
    for (const ext of SOURCE_EXTENSIONS) {
      if (this.fileSet.has(base + ext)) return base + ext;
    }
    for (const ext of SOURCE_EXTENSIONS) {
      if (this.fileSet.has(base + "/index" + ext)) return base + "/index" + ext;
    }
    return null;
  }

  private resolvePackageEntry(pkg: Pkg): string | null {
    const m = pkg.manifest;
    const fromExports = stringFromExports(m.exports);
    const candidates = [
      m.source,
      fromExports,
      m.module,
      m.main,
      "src/index",
      "src/main",
      "index",
      "lib/index",
    ].filter((c): c is string => typeof c === "string" && c.length > 0);
    for (const c of candidates) {
      const hit = this.resolveToFile(path.join(pkg.dir, c));
      if (hit) return hit;
    }
    return null;
  }

  resolve(from: string, spec: string): string | null {
    if (spec.startsWith(".")) {
      return this.resolveToFile(path.join(path.dirname(from), spec));
    }
    if (spec.startsWith("/")) return null; // absolute imports are not workspace-internal

    // Workspace package by longest matching name.
    for (const { name, pkg } of this.namesByLen) {
      if (spec === name) return this.resolvePackageEntry(pkg);
      if (spec.startsWith(name + "/")) {
        const sub = spec.slice(name.length + 1);
        return this.resolveToFile(path.join(pkg.dir, sub));
      }
    }
    return null; // external dependency -> leaf
  }

  /** Files reachable from a set of seed files (inclusive), following imports. */
  reachableFiles(seeds: string[]): Set<string> {
    const seen = new Set<string>(seeds);
    const queue = [...seeds];
    while (queue.length) {
      const cur = queue.shift()!;
      const next = this.edges.get(cur);
      if (!next) continue;
      for (const n of next) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    return seen;
  }

  /** Reachable file set + the packages those files belong to. */
  reachFromApp(app: Pkg): { files: Set<string>; packages: Set<string> } {
    const seeds = this.filesOf(app);
    const files = this.reachableFiles(seeds);
    const packages = new Set<string>();
    for (const f of files) {
      const owner = this.fileOwner.get(f);
      if (owner) packages.add(owner.name);
    }
    return { files, packages };
  }

  /** Shortest import path (list of files) from any app seed to `target`, or null. */
  pathTo(app: Pkg, target: string): string[] | null {
    const seeds = this.filesOf(app);
    if (seeds.includes(target)) return [target];
    const parent = new Map<string, string | null>();
    const queue: string[] = [];
    for (const s of seeds) {
      parent.set(s, null);
      queue.push(s);
    }
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur === target) break;
      for (const n of this.edges.get(cur) ?? []) {
        if (!parent.has(n)) {
          parent.set(n, cur);
          queue.push(n);
        }
      }
    }
    if (!parent.has(target)) return null;
    const out: string[] = [];
    let node: string | null = target;
    while (node) {
      out.unshift(node);
      node = parent.get(node) ?? null;
    }
    return out;
  }

  /**
   * Collapse a file path into a readable "app -> package -> file" chain,
   * dropping consecutive files within the same package.
   */
  collapseChain(filePath: string[]): string[] {
    const chain: string[] = [];
    let lastPkg: string | null = null;
    for (const f of filePath) {
      const owner = this.fileOwner.get(f);
      const label = owner ? owner.relDir : "?";
      if (label !== lastPkg) {
        chain.push(label);
        lastPkg = label;
      }
    }
    const lastFile = filePath[filePath.length - 1];
    chain.push(path.basename(lastFile));
    return chain;
  }
}

/** Pull a usable string entry out of a package.json "exports" field. */
function stringFromExports(exports: unknown): string | undefined {
  if (typeof exports === "string") return exports;
  if (exports && typeof exports === "object") {
    const root = (exports as Record<string, unknown>)["."] ?? exports;
    if (typeof root === "string") return root;
    if (root && typeof root === "object") {
      const o = root as Record<string, unknown>;
      for (const key of ["source", "import", "require", "default", "node", "types"]) {
        const v = o[key];
        if (typeof v === "string") return v;
      }
    }
  }
  return undefined;
}
