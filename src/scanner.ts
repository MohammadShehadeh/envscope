/**
 * AST-based scanning of a single source file (ts-morph, never regex).
 *
 * From one file we extract two things in a single traversal:
 *   - env-var usages  (process.env.X, import.meta.env.X, destructuring, env.X)
 *   - module specifiers (static imports, re-exports, dynamic import(), require())
 *
 * The specifiers feed the dependency graph; the usages feed per-app aggregation.
 */
import { Project, Node, SyntaxKind, type SourceFile } from "ts-morph";
import type { EnvPattern } from "./types";

export interface RawUsage {
  name: string;
  line: number;
  column: number;
  pattern: EnvPattern;
}

export interface FileScan {
  usages: RawUsage[];
  /** Raw module specifier strings, e.g. "./client", "@scope/payments". */
  specifiers: string[];
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const UPPER_SNAKE = /^[A-Z][A-Z0-9_]*$/;

/** A ts-morph Project tuned for fast, type-check-free AST parsing. */
export function createProject(): Project {
  return new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
    compilerOptions: {
      allowJs: true,
      noLib: true,
      // jsx: preserve so .tsx parses without a tsconfig.
      jsx: 2 /* ts.JsxEmit.React = 2; any non-zero value enables JSX parsing */,
    },
  });
}

function isProcessEnv(node: Node): boolean {
  return (
    Node.isPropertyAccessExpression(node) &&
    node.getName() === "env" &&
    Node.isIdentifier(node.getExpression()) &&
    node.getExpression().getText() === "process"
  );
}

function isImportMetaEnv(node: Node): boolean {
  return (
    Node.isPropertyAccessExpression(node) &&
    node.getName() === "env" &&
    node.getExpression().getKind() === SyntaxKind.MetaProperty &&
    node.getExpression().getText() === "import.meta"
  );
}

/** Local binding names introduced by imports that are literally named `env`. */
function collectEnvWrapperNames(sf: SourceFile): Set<string> {
  const names = new Set<string>();
  for (const imp of sf.getImportDeclarations()) {
    const def = imp.getDefaultImport()?.getText();
    if (def === "env") names.add("env");
    const ns = imp.getNamespaceImport()?.getText();
    if (ns === "env") names.add("env");
    for (const n of imp.getNamedImports()) {
      const local = n.getAliasNode()?.getText() ?? n.getName();
      if (local === "env") names.add("env");
    }
  }
  return names;
}

function collectSpecifiers(sf: SourceFile): string[] {
  const specs: string[] = [];

  for (const imp of sf.getImportDeclarations()) {
    specs.push(imp.getModuleSpecifierValue());
  }
  for (const exp of sf.getExportDeclarations()) {
    const v = exp.getModuleSpecifierValue();
    if (v) specs.push(v); // re-export: export ... from "x"
  }
  // Dynamic import() and require("...").
  sf.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    const isImportCall = expr.getKind() === SyntaxKind.ImportKeyword;
    const isRequire = Node.isIdentifier(expr) && expr.getText() === "require";
    if (!isImportCall && !isRequire) return;
    const first = node.getArguments()[0];
    if (first && Node.isStringLiteral(first)) specs.push(first.getLiteralValue());
  });

  return specs;
}

export function scanSourceFile(sf: SourceFile): FileScan {
  const usages: RawUsage[] = [];
  const wrapperNames = collectEnvWrapperNames(sf);

  const push = (name: string, node: Node, pattern: EnvPattern, upperOnly = false) => {
    if (!name) return;
    if (upperOnly ? !UPPER_SNAKE.test(name) : !IDENT.test(name)) return;
    const { line, column } = sf.getLineAndColumnAtPos(node.getStart());
    usages.push({ name, line, column, pattern });
  };

  sf.forEachDescendant((node) => {
    // process.env.X  /  import.meta.env.X
    if (Node.isPropertyAccessExpression(node)) {
      const obj = node.getExpression();
      if (isProcessEnv(obj)) {
        push(node.getName(), node, "process.env");
        return;
      }
      if (isImportMetaEnv(obj)) {
        push(node.getName(), node, "import.meta.env");
        return;
      }
      // env.X  (only when `env` was imported from a typed env module)
      if (
        Node.isIdentifier(obj) &&
        wrapperNames.has(obj.getText())
      ) {
        push(node.getName(), node, "env-wrapper", /* upperOnly */ true);
        return;
      }
    }

    // process.env["X"]  /  import.meta.env["X"]  /  env["X"]
    if (Node.isElementAccessExpression(node)) {
      const obj = node.getExpression();
      const arg = node.getArgumentExpression();
      if (arg && Node.isStringLiteral(arg)) {
        const key = arg.getLiteralValue();
        if (isProcessEnv(obj)) return push(key, node, "process.env");
        if (isImportMetaEnv(obj)) return push(key, node, "import.meta.env");
        if (Node.isIdentifier(obj) && wrapperNames.has(obj.getText())) {
          return push(key, node, "env-wrapper", true);
        }
      }
    }

    // const { X, Y: alias } = process.env  /  = import.meta.env
    if (Node.isVariableDeclaration(node)) {
      const init = node.getInitializer();
      const nameNode = node.getNameNode();
      if (init && Node.isObjectBindingPattern(nameNode)) {
        const pattern: EnvPattern | null = isProcessEnv(init)
          ? "process.env"
          : isImportMetaEnv(init)
            ? "import.meta.env"
            : null;
        if (pattern) {
          for (const el of nameNode.getElements()) {
            const key = el.getPropertyNameNode()?.getText() ?? el.getNameNode().getText();
            push(key.replace(/^["']|["']$/g, ""), el, pattern);
          }
        }
      }
    }
  });

  return { usages, specifiers: collectSpecifiers(sf) };
}
