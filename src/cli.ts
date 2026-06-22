#!/usr/bin/env node
/**
 * envscope CLI.
 *
 *   envscope analyze            Analyze every app in the repo (default)
 *   envscope app <path|name>    Analyze a single app
 *   envscope find <ENV_VAR>     Show which apps require an env var, and the chain
 *
 * Flags: --json  --md  --cwd <dir>  --schema <file>  --no-color  --help  --version
 */
import { analyzeRepo, findEnvVar } from "./analyze";
import {
  analysisToJson,
  analysisToMarkdown,
  findToJson,
  findToMarkdown,
  renderAnalysisHuman,
  renderFindHuman,
} from "./output";

interface Args {
  command: string;
  positional: string[];
  json: boolean;
  md: boolean;
  noColor: boolean;
  cwd: string;
  schema?: string;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: "",
    positional: [],
    json: false,
    md: false,
    noColor: false,
    cwd: process.cwd(),
    help: false,
    version: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--json":
        args.json = true;
        break;
      case "--md":
      case "--markdown":
        args.md = true;
        break;
      case "--no-color":
        args.noColor = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "-v":
      case "--version":
        args.version = true;
        break;
      case "--cwd":
        args.cwd = argv[++i] ?? args.cwd;
        break;
      case "--schema":
        args.schema = argv[++i];
        break;
      default:
        if (a.startsWith("--cwd=")) args.cwd = a.slice(6);
        else if (a.startsWith("--schema=")) args.schema = a.slice(9);
        else if (!args.command) args.command = a;
        else args.positional.push(a);
    }
  }
  return args;
}

const HELP = `envscope — which env vars each app actually requires (via its dependency graph)

Usage:
  envscope [analyze]              Analyze every app in the repo
  envscope app <path|name>       Analyze a single app (e.g. apps/web)
  envscope find <ENV_VAR>        Reverse lookup: which apps require ENV_VAR

Options:
  --json                Output JSON
  --md, --markdown      Output Markdown
  --cwd <dir>           Repo root to analyze (default: current directory)
  --schema <file>       Use a specific .env schema/example for diffing
  --no-color            Disable ANSI colors
  -h, --help            Show this help
  -v, --version         Show version

Examples:
  envscope
  envscope app apps/web --json
  envscope find STRIPE_SECRET
  envscope analyze --cwd ../my-monorepo --md > ENV_REPORT.md`;

const ANSI = /\[[0-9;]*m/g;
function emit(text: string, noColor: boolean): void {
  process.stdout.write((noColor ? text.replace(ANSI, "") : text) + "\n");
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require("../package.json") as { version: string };
    process.stdout.write(`${pkg.version}\n`);
    return;
  }
  if (args.help) {
    emit(HELP, args.noColor);
    return;
  }

  const command = args.command || "analyze";

  try {
    if (command === "find") {
      const varName = args.positional[0];
      if (!varName) {
        emit("Usage: envscope find <ENV_VAR>", args.noColor);
        process.exitCode = 2;
        return;
      }
      const result = analyzeRepo(args.cwd, { schema: args.schema });
      const chains = findEnvVar(result, varName);
      if (args.json) emit(JSON.stringify(findToJson(varName, chains), null, 2), true);
      else if (args.md) emit(findToMarkdown(varName, chains), true);
      else emit(renderFindHuman(varName, chains), args.noColor);
      return;
    }

    if (command === "app") {
      const target = args.positional[0];
      if (!target) {
        emit("Usage: envscope app <path|name>", args.noColor);
        process.exitCode = 2;
        return;
      }
      const result = analyzeRepo(args.cwd, { schema: args.schema, onlyApp: target });
      if (result.analysis.apps.length === 0) {
        emit(`No app matching "${target}" was found.`, args.noColor);
        process.exitCode = 1;
        return;
      }
      print(result.analysis, args);
      return;
    }

    if (command === "analyze") {
      const result = analyzeRepo(args.cwd, { schema: args.schema });
      print(result.analysis, args);
      return;
    }

    emit(`Unknown command "${command}".\n`, args.noColor);
    emit(HELP, args.noColor);
    process.exitCode = 2;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`envscope: ${msg}\n`);
    process.exitCode = 1;
  }
}

function print(analysis: ReturnType<typeof analyzeRepo>["analysis"], args: Args): void {
  if (args.json) emit(JSON.stringify(analysisToJson(analysis), null, 2), true);
  else if (args.md) emit(analysisToMarkdown(analysis), true);
  else emit(renderAnalysisHuman(analysis), args.noColor);
}

main();
