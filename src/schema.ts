/**
 * Optional env schema support.
 *
 * A "schema" is any of: .env.schema, .env.example, .env.sample, .env.template,
 * or .env.defaults. We read the *keys* (values are ignored) and use them to
 * report:
 *   - used-but-not-defined  (you'll get a runtime undefined)
 *   - defined-but-unused    (dead config / drift)
 */
import fs from "node:fs";
import path from "node:path";
import type { SchemaDiff } from "./types";
import { norm } from "./paths";

const SCHEMA_FILENAMES = [
  ".env.schema",
  ".env.example",
  ".env.sample",
  ".env.template",
  ".env.defaults",
];

/** KEY=... or `export KEY=...` or a bare KEY line in a checklist-style schema. */
const ASSIGN = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const BARE = /^\s*([A-Z][A-Z0-9_]*)\s*$/;

export interface LoadedSchema {
  file: string;
  keys: Set<string>;
}

function parseSchema(file: string): Set<string> {
  const keys = new Set<string>();
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return keys;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = ASSIGN.exec(line) ?? BARE.exec(line);
    if (m) keys.add(m[1]);
  }
  return keys;
}

/**
 * Find a schema for an app: prefer one inside the app dir, fall back to the
 * repo root. An explicit path (from --schema) wins.
 */
export function loadSchema(
  appDir: string,
  rootDir: string,
  explicit?: string,
): LoadedSchema | null {
  if (explicit) {
    const abs = norm(explicit);
    if (fs.existsSync(abs)) return { file: abs, keys: parseSchema(abs) };
  }
  for (const dir of [appDir, rootDir]) {
    for (const name of SCHEMA_FILENAMES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) {
        return { file: norm(candidate), keys: parseSchema(candidate) };
      }
    }
  }
  return null;
}

export function diffSchema(used: Set<string>, schema: LoadedSchema | null): SchemaDiff | undefined {
  if (!schema) return undefined;
  const usedButUndefined: string[] = [];
  for (const name of used) if (!schema.keys.has(name)) usedButUndefined.push(name);
  const definedButUnused: string[] = [];
  for (const key of schema.keys) if (!used.has(key)) definedButUnused.push(key);
  return {
    usedButUndefined: usedButUndefined.sort(),
    definedButUnused: definedButUnused.sort(),
    schemaFile: schema.file,
  };
}
