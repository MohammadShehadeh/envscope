/**
 * Rendering: human-readable (default), JSON (--json), and markdown (--md).
 */
import pc from "picocolors";
import type { AppAnalysis, FindChain, RepoAnalysis } from "./types";

/* ----------------------------------- analyze ----------------------------------- */

function patternTag(p: string): string {
  return pc.dim(`(${p})`);
}

function renderApp(app: AppAnalysis, lines: string[]): void {
  const title = `${app.app.relDir}` + (app.app.name !== app.app.relDir ? `  ${pc.dim(app.app.name)}` : "");
  lines.push(pc.bold(pc.cyan(`App: ${title}`)));
  lines.push("");

  if (app.envVars.length === 0) {
    lines.push(pc.dim("  (no environment variables required)"));
  } else {
    lines.push(`Required env vars (${app.envVars.length}):`);
    lines.push("");
    for (const v of app.envVars) {
      lines.push(`  - ${pc.yellow(pc.bold(v.name))}`);
      for (const u of v.usages) {
        lines.push(`      ${pc.dim(`${u.relFile}:${u.line}`)} ${patternTag(u.pattern)}`);
      }
    }
  }

  if (app.schema) {
    lines.push("");
    const rel = app.schema.schemaFile ? shortPath(app.schema.schemaFile) : "schema";
    lines.push(pc.dim(`Schema (${rel}):`));
    if (app.schema.usedButUndefined.length) {
      lines.push(`  ${pc.red("❌ used but not defined:")} ${app.schema.usedButUndefined.join(", ")}`);
    }
    if (app.schema.definedButUnused.length) {
      lines.push(`  ${pc.yellow("⚠️  defined but unused:")} ${app.schema.definedButUnused.join(", ")}`);
    }
    if (!app.schema.usedButUndefined.length && !app.schema.definedButUnused.length) {
      lines.push(`  ${pc.green("✓ schema matches usage")}`);
    }
  }
  lines.push("");
}

export function renderAnalysisHuman(analysis: RepoAnalysis): string {
  const lines: string[] = [];
  const kind = analysis.isMonorepo ? "monorepo" : "single-package repo";
  lines.push(
    pc.dim(
      `${shortPath(analysis.root)} · ${kind} · ${analysis.apps.length} app(s) · ${analysis.packages.length} package(s)`,
    ),
  );
  lines.push("");

  if (analysis.apps.length === 0) {
    lines.push(pc.yellow("No apps detected."));
    return lines.join("\n");
  }

  for (const app of analysis.apps) renderApp(app, lines);

  const sharedNames = Object.keys(analysis.shared).sort();
  if (sharedNames.length) {
    lines.push(pc.bold("🔁 Shared across apps:"));
    for (const name of sharedNames) {
      lines.push(`  ${pc.yellow(name)} ${pc.dim("→ " + analysis.shared[name].join(", "))}`);
    }
    lines.push("");
  }

  return lines.join("\n").replace(/\n+$/, "\n");
}

/* ------------------------------------- find ------------------------------------ */

export function renderFindHuman(name: string, chains: FindChain[]): string {
  if (chains.length === 0) {
    return pc.yellow(`${name} is not used by any app in this repo.`);
  }
  const lines: string[] = [];
  lines.push(`${pc.yellow(pc.bold(name))} is used in:`);
  for (const c of chains) {
    const arrowed = c.chain
      .map((seg, i) => (i === c.chain.length - 1 ? pc.cyan(seg) : seg))
      .join(pc.dim(" → "));
    lines.push(`  - ${arrowed} ${pc.dim(`(${c.usage.relFile}:${c.usage.line})`)}`);
  }
  return lines.join("\n");
}

/* ------------------------------------- json ------------------------------------ */

export function analysisToJson(analysis: RepoAnalysis): unknown {
  return {
    root: analysis.root,
    isMonorepo: analysis.isMonorepo,
    packages: analysis.packages.map((p) => ({
      name: p.name,
      relDir: p.relDir,
      kind: p.kind,
    })),
    apps: analysis.apps.map((a) => ({
      name: a.app.name,
      relDir: a.app.relDir,
      reachablePackages: a.reachablePackages,
      envVars: a.envVars.map((v) => ({
        name: v.name,
        packages: v.packages,
        usages: v.usages.map((u) => ({
          file: u.relFile,
          line: u.line,
          column: u.column,
          pattern: u.pattern,
        })),
      })),
      schema: a.schema
        ? {
            schemaFile: a.schema.schemaFile,
            usedButUndefined: a.schema.usedButUndefined,
            definedButUnused: a.schema.definedButUnused,
          }
        : null,
    })),
    shared: analysis.shared,
  };
}

export function findToJson(name: string, chains: FindChain[]): unknown {
  return {
    name,
    usedBy: chains.map((c) => ({
      app: c.app.relDir,
      chain: c.chain,
      file: c.usage.relFile,
      line: c.usage.line,
      pattern: c.usage.pattern,
    })),
  };
}

/* ----------------------------------- markdown ---------------------------------- */

export function analysisToMarkdown(analysis: RepoAnalysis): string {
  const md: string[] = [];
  md.push(`# envscope report`);
  md.push("");
  md.push(
    `> ${analysis.isMonorepo ? "Monorepo" : "Single-package repo"} · ${analysis.apps.length} app(s) · ${analysis.packages.length} package(s)`,
  );
  md.push("");
  for (const app of analysis.apps) {
    md.push(`## ${app.app.relDir} (\`${app.app.name}\`)`);
    md.push("");
    if (app.envVars.length === 0) {
      md.push("_No environment variables required._");
      md.push("");
      continue;
    }
    md.push(`**Required env vars (${app.envVars.length}):**`);
    md.push("");
    for (const v of app.envVars) {
      md.push(`- \`${v.name}\``);
      for (const u of v.usages) {
        md.push(`  - \`${u.relFile}:${u.line}\` _(${u.pattern})_`);
      }
    }
    md.push("");
    if (app.schema) {
      if (app.schema.usedButUndefined.length) {
        md.push(`> ❌ **used but not defined:** ${app.schema.usedButUndefined.map((s) => "`" + s + "`").join(", ")}`);
      }
      if (app.schema.definedButUnused.length) {
        md.push(`> ⚠️ **defined but unused:** ${app.schema.definedButUnused.map((s) => "`" + s + "`").join(", ")}`);
      }
      md.push("");
    }
  }
  const sharedNames = Object.keys(analysis.shared).sort();
  if (sharedNames.length) {
    md.push(`## 🔁 Shared across apps`);
    md.push("");
    for (const name of sharedNames) {
      md.push(`- \`${name}\` → ${analysis.shared[name].join(", ")}`);
    }
    md.push("");
  }
  return md.join("\n");
}

export function findToMarkdown(name: string, chains: FindChain[]): string {
  const md: string[] = [`# \`${name}\``, ""];
  if (chains.length === 0) {
    md.push("_Not used by any app in this repo._");
    return md.join("\n");
  }
  md.push(`\`${name}\` is used in:`);
  md.push("");
  for (const c of chains) {
    md.push(`- ${c.chain.join(" → ")} (\`${c.usage.relFile}:${c.usage.line}\`)`);
  }
  return md.join("\n");
}

/* ----------------------------------- helpers ----------------------------------- */

function shortPath(p: string): string {
  const parts = p.split("/");
  return parts.length > 3 ? "…/" + parts.slice(-2).join("/") : p;
}
