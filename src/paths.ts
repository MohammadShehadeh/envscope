/**
 * Path helpers. We normalize every path to absolute + forward-slash so that
 * comparisons, Set membership, and "is this inside that package" checks behave
 * consistently across Windows and POSIX.
 */
import path from "node:path";

/** Absolute path with forward slashes. */
export function norm(p: string): string {
  return path.resolve(p).split(path.sep).join("/");
}

/** Join + normalize. */
export function joinNorm(...parts: string[]): string {
  return norm(path.join(...parts));
}

/** Repo-relative path with forward slashes ("." for the root itself). */
export function relFrom(root: string, p: string): string {
  const rel = path.relative(root, p).split(path.sep).join("/");
  return rel === "" ? "." : rel;
}

export const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

/** Directories we never descend into when collecting source files. */
export const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  ".vercel",
  "coverage",
  ".cache",
]);

export function hasSourceExtension(p: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => p.endsWith(ext));
}
