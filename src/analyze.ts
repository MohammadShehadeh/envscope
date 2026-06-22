/**
 * Top-level analysis pipeline:
 *   discover packages -> collect source -> AST scan -> build graph ->
 *   per-app reachability + env aggregation -> schema diff -> shared vars.
 */
import fs from "node:fs";
import path from "node:path";
import type {
  AppAnalysis,
  AppEnvVar,
  EnvUsage,
  FindChain,
  Pkg,
  RepoAnalysis,
} from "./types";
import { norm, relFrom, hasSourceExtension, IGNORED_DIRS } from "./paths";
import { discoverWorkspace } from "./workspace";
import { createProject, scanSourceFile, type RawUsage } from "./scanner";
import { DependencyGraph } from "./graph";
import { loadSchema, diffSchema } from "./schema";

export interface AnalyzeOptions {
  /** Explicit schema file (overrides auto-detection). */
  schema?: string;
  /** Restrict analysis to a single app, by relDir or name. */
  onlyApp?: string;
}

export interface AnalyzeResult {
  analysis: RepoAnalysis;
  graph: DependencyGraph;
  /** file -> raw env usages, for ad-hoc lookups. */
  usagesByFile: Map<string, RawUsage[]>;
}

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 24) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        walk(full, depth + 1);
      } else if (e.isFile() && hasSourceExtension(e.name) && !e.name.endsWith(".d.ts")) {
        out.push(norm(full));
      }
    }
  };
  walk(dir, 0);
  return out;
}

export function analyzeRepo(root: string, opts: AnalyzeOptions = {}): AnalyzeResult {
  const absRoot = norm(root);
  const ws = discoverWorkspace(absRoot);

  // 1. Collect every source file across every package (deduped).
  const fileSet = new Set<string>();
  for (const pkg of ws.packages) {
    for (const f of collectSourceFiles(pkg.dir)) fileSet.add(f);
  }
  const files = [...fileSet];

  // 2. AST scan each file once for env usages + import specifiers.
  const project = createProject();
  const usagesByFile = new Map<string, RawUsage[]>();
  const graph = new DependencyGraph(ws.packages, files);

  for (const file of files) {
    const sf = project.addSourceFileAtPathIfExists(file);
    if (!sf) continue;
    const scan = scanSourceFile(sf);
    if (scan.usages.length) usagesByFile.set(file, scan.usages);
    for (const spec of scan.specifiers) graph.addImport(file, spec);
    // Release AST memory; we don't need the node tree after scanning.
    project.removeSourceFile(sf);
  }

  // 3. Per-app aggregation over the reachable file set.
  const apps = ws.packages.filter((p) => p.kind === "app");
  const selected = opts.onlyApp
    ? apps.filter((a) => a.relDir === opts.onlyApp || a.name === opts.onlyApp)
    : apps;

  const appAnalyses: AppAnalysis[] = selected.map((app) =>
    analyzeApp(app, absRoot, graph, usagesByFile, opts.schema),
  );

  // 4. Shared env vars across apps (computed over ALL apps, not just selected).
  const shared = computeShared(
    opts.onlyApp
      ? apps.map((app) => analyzeApp(app, absRoot, graph, usagesByFile, opts.schema))
      : appAnalyses,
  );

  const analysis: RepoAnalysis = {
    root: absRoot,
    isMonorepo: ws.isMonorepo,
    packages: ws.packages,
    apps: appAnalyses,
    shared,
  };

  return { analysis, graph, usagesByFile };
}

function analyzeApp(
  app: Pkg,
  root: string,
  graph: DependencyGraph,
  usagesByFile: Map<string, RawUsage[]>,
  schemaPath?: string,
): AppAnalysis {
  const { files, packages } = graph.reachFromApp(app);

  const byName = new Map<string, EnvUsage[]>();
  for (const file of files) {
    const raws = usagesByFile.get(file);
    if (!raws) continue;
    const owner = graph.ownerOf(file);
    for (const r of raws) {
      const usage: EnvUsage = {
        name: r.name,
        file,
        relFile: relFrom(root, file),
        pkg: owner?.name ?? "(unknown)",
        line: r.line,
        column: r.column,
        pattern: r.pattern,
      };
      const list = byName.get(r.name) ?? [];
      list.push(usage);
      byName.set(r.name, list);
    }
  }

  const envVars: AppEnvVar[] = [...byName.entries()]
    .map(([name, usages]) => {
      usages.sort((a, b) => a.relFile.localeCompare(b.relFile) || a.line - b.line);
      const pkgs = [...new Set(usages.map((u) => u.pkg))].sort();
      return { name, usages, packages: pkgs };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const usedNames = new Set(envVars.map((v) => v.name));
  const schema = diffSchema(usedNames, loadSchema(app.dir, root, schemaPath));

  return {
    app,
    reachableFiles: [...files].sort(),
    reachablePackages: [...packages].sort(),
    envVars,
    schema,
  };
}

function computeShared(apps: AppAnalysis[]): Record<string, string[]> {
  const map = new Map<string, Set<string>>();
  for (const app of apps) {
    for (const v of app.envVars) {
      const set = map.get(v.name) ?? new Set<string>();
      set.add(app.app.relDir);
      map.set(v.name, set);
    }
  }
  const shared: Record<string, string[]> = {};
  for (const [name, set] of map) {
    if (set.size > 1) shared[name] = [...set].sort();
  }
  return shared;
}

/**
 * Reverse lookup: where does env var `name` come from, per app, as a chain
 * "app -> package -> file". Falls back to listing orphan files if the var is
 * used somewhere but not reachable from any app.
 */
export function findEnvVar(result: AnalyzeResult, name: string): FindChain[] {
  const { analysis, graph, usagesByFile } = result;
  const chains: FindChain[] = [];

  for (const app of analysis.apps) {
    const match = app.envVars.find((v) => v.name === name);
    if (!match) continue;
    // Pick the usage that yields the shortest, clearest chain.
    let best: { chain: string[]; usage: EnvUsage } | null = null;
    for (const usage of match.usages) {
      const filePath = graph.pathTo(app.app, usage.file);
      if (!filePath) continue;
      const chain = graph.collapseChain(filePath);
      if (!best || chain.length < best.chain.length) best = { chain, usage };
    }
    if (best) chains.push({ app: app.app, chain: best.chain, usage: best.usage });
  }

  // Orphan fallback: var used in code but attributed to no app.
  if (chains.length === 0) {
    for (const [file, raws] of usagesByFile) {
      if (!raws.some((r) => r.name === name)) continue;
      const owner = graph.ownerOf(file);
      const r = raws.find((u) => u.name === name)!;
      chains.push({
        app: owner ?? analysis.packages[0],
        chain: [owner?.relDir ?? "?", path.basename(file)],
        usage: {
          name,
          file,
          relFile: relFrom(analysis.root, file),
          pkg: owner?.name ?? "(unknown)",
          line: r.line,
          column: r.column,
          pattern: r.pattern,
        },
      });
    }
  }

  return chains;
}
