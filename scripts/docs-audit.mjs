#!/usr/bin/env node
/**
 * The documentation gate.
 *
 * Reports three kinds of gap and exits non-zero while any remain:
 *
 * - `jsdoc`       — a declaration with no JSDoc block. Every declaration counts: exported,
 *                   public, private, internal. Test files are exempt unless `--include-tests`.
 * - `folders`     — a folder that holds source files but has no `README.md`, or whose
 *                   `README.md` is empty.
 * - `maintenance` — the repository root `README.md` does not carry the upkeep block, identified
 *                   by the marker below, or the root `AGENTS.md` or `CLAUDE.md` neither carries
 *                   the block nor points at `README.md`.
 *
 * The gate parses with the repository's own TypeScript compiler rather than with patterns, so a
 * declaration cannot hide behind formatting. It adds no dependency: `typescript` is already
 * present in any repository this gate applies to.
 *
 * Exit codes: 0 = no gaps, 1 = gaps found, 2 = the gate could not run.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/** Marker that proves the root files carry the upkeep block. Changing it invalidates every repo. */
export const MAINTENANCE_MARKER = '<!-- docs-audit:maintenance -->';

/** Extensions the gate treats as source. JSDoc is a JavaScript and TypeScript convention. */
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

/**
 * Paths the gate never scans, on top of everything git ignores.
 *
 * Build output and vendored code are not written by hand, so a missing doc there is noise
 * rather than a defect.
 */
const DEFAULT_EXCLUDES = [
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.git',
  '.next',
  '.turbo',
  '.claude/worktrees',
  'vendor',
];

/** Test and mock files, exempt from the JSDoc rule unless `--include-tests` is passed. */
const TEST_PATTERN =
  /(^|\/)(__tests__|__mocks__|test|tests)\/|(\.|-)(test|spec)\.[cm]?[jt]sx?$/;

/**
 * Loads the TypeScript compiler from the audited repository.
 *
 * Resolution starts at the repository root so the gate uses the same compiler version as the
 * code it reads, whatever hoisting or workspace layout the repository uses.
 *
 * @param {string} root Absolute path to the repository root.
 * @returns {object | null} The TypeScript module, or null when it is not installed.
 */
function loadTypeScript(root) {
  const requireFrom = createRequire(join(root, 'package.json'));
  try {
    return requireFrom('typescript');
  } catch {
    return null;
  }
}

/**
 * Lists every source file the gate must consider.
 *
 * Git is the preferred index: `--cached --others --exclude-standard` yields tracked files plus
 * new untracked ones while honouring `.gitignore`, so a brand-new undocumented file cannot slip
 * through and a generated one cannot create false work. A directory walk covers repositories
 * without git and explicit `--root` arguments.
 *
 * @param {string} root Absolute path to the repository root.
 * @param {string[]} roots Explicit roots to walk instead of asking git.
 * @param {string[]} excludes Path fragments to drop.
 * @returns {string[]} Absolute paths, sorted.
 */
export function discoverSourceFiles(root, roots, excludes) {
  const collected = [];
  if (roots.length > 0) {
    for (const dir of roots) walkInto(resolve(root, dir), collected);
  } else {
    const tracked = gitFiles(root);
    if (tracked) collected.push(...tracked.map((file) => join(root, file)));
    else walkInto(root, collected);
  }
  const kept = collected.filter(
    (file) => SOURCE_EXTENSIONS.has(extname(file)) && !isExcluded(relative(root, file), excludes),
  );
  return [...new Set(kept)].sort();
}

/**
 * Asks git for the working set: tracked files plus untracked files that are not ignored.
 *
 * @param {string} root Absolute path to the repository root.
 * @returns {string[] | null} Repository-relative paths, or null when git cannot answer.
 */
function gitFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return out.split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * Adds every file under a directory to the accumulator, skipping the default excluded folders.
 *
 * @param {string} dir Absolute directory path.
 * @param {string[]} out Accumulator of absolute file paths.
 */
function walkInto(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (DEFAULT_EXCLUDES.includes(entry.name)) continue;
      walkInto(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

/**
 * Decides whether a repository-relative path falls inside an excluded area.
 *
 * @param {string} relPath Repository-relative path.
 * @param {string[]} excludes Extra fragments supplied by the caller.
 * @returns {boolean} True when the path must be skipped.
 */
function isExcluded(relPath, excludes) {
  const posix = relPath.split(sep).join('/');
  return [...DEFAULT_EXCLUDES, ...excludes].some(
    (fragment) => posix === fragment || posix.startsWith(`${fragment}/`) || posix.includes(`/${fragment}/`),
  );
}

/**
 * Finds every undocumented declaration in one file.
 *
 * The walk descends into source files, classes, interfaces, enums, and namespaces, and stops at
 * function bodies: a local inside a function is an implementation detail, not a declaration the
 * reader of the module ever sees.
 *
 * @param {object} ts The TypeScript compiler module.
 * @param {string} fileName Path used for diagnostics.
 * @param {string} text File contents.
 * @returns {{line: number, kind: string, name: string}[]} Gaps, in source order.
 */
export function auditDeclarations(ts, fileName, text) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const gaps = [];

  const documented = (node) =>
    (ts.getJSDocCommentsAndTags(node) || []).some((doc) => {
      const body = ts.getTextOfJSDocComment(doc.comment) ?? '';
      return body.trim().length > 0 || (doc.tags ?? []).length > 0;
    });
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const nameOf = (node) => (node.name ? node.name.getText(source) : '(anonymous)');
  const record = (node, kind, name) => {
    if (!documented(node)) gaps.push({ line: lineOf(node), kind, name });
  };

  /** Names declared without a body in the current container: the signatures of an overload set. */
  let overloaded = new Set();

  /**
   * Decides whether a node is the implementation of an overload set.
   *
   * TypeScript convention documents the overload signatures, which is what a caller reads. The
   * implementation signature is unreachable from outside, so demanding a block on it produces
   * text nobody needs.
   *
   * @param {object} node A function or method node.
   * @returns {boolean} True when the node is an overload implementation.
   */
  const isOverloadImplementation = (node) =>
    Boolean(node.body) && node.name && overloaded.has(node.name.getText(source));

  /**
   * Visits one declaration node.
   *
   * @param {object} node A TypeScript AST node.
   */
  function visit(node) {
    const k = ts.SyntaxKind;
    switch (node.kind) {
      case k.VariableStatement:
        // JSDoc binds to the statement, not to the individual declarator.
        for (const declaration of node.declarationList.declarations) {
          record(node, 'variable', declaration.name.getText(source));
        }
        return;
      case k.FunctionDeclaration:
        if (!isOverloadImplementation(node)) record(node, 'function', nameOf(node));
        return;
      case k.ClassDeclaration:
      case k.ClassExpression:
        record(node, 'class', nameOf(node));
        visitContainer(node.members);
        return;
      case k.InterfaceDeclaration:
        record(node, 'interface', nameOf(node));
        node.members.forEach(visit);
        return;
      case k.TypeAliasDeclaration:
        record(node, 'type', nameOf(node));
        return;
      case k.EnumDeclaration:
        record(node, 'enum', nameOf(node));
        node.members.forEach(visit);
        return;
      case k.EnumMember:
        record(node, 'enum member', nameOf(node));
        return;
      case k.ModuleDeclaration:
        record(node, 'namespace', nameOf(node));
        if (node.body && node.body.statements) node.body.statements.forEach(visit);
        return;
      case k.MethodDeclaration:
      case k.MethodSignature:
        if (!isOverloadImplementation(node)) record(node, 'method', nameOf(node));
        return;
      case k.PropertyDeclaration:
      case k.PropertySignature:
        record(node, 'property', nameOf(node));
        return;
      case k.GetAccessor:
      case k.SetAccessor:
        record(node, 'accessor', nameOf(node));
        return;
      case k.Constructor:
        record(node, 'constructor', 'constructor');
        return;
      default:
    }
  }

  /**
   * Visits the members of one container, noting its overload signatures first.
   *
   * @param {object[]} members Statements or class members.
   */
  function visitContainer(members) {
    const outer = overloaded;
    overloaded = new Set(
      members
        .filter((m) => !m.body && m.name && (m.kind === ts.SyntaxKind.FunctionDeclaration || m.kind === ts.SyntaxKind.MethodDeclaration))
        .map((m) => m.name.getText(source)),
    );
    members.forEach(visit);
    overloaded = outer;
  }

  visitContainer(source.statements);
  return gaps.sort((a, b) => a.line - b.line);
}

/**
 * Checks the per-folder documentation contract for one directory.
 *
 * One file per folder, because both providers read `README.md` and a second copy of the same
 * text is a second text to keep current.
 *
 * @param {string} dir Absolute directory path.
 * @returns {string[]} Reasons the folder fails, empty when it passes.
 */
export function auditFolder(dir) {
  const readme = join(dir, 'README.md');
  if (!existsSync(readme) || readFileSync(readme, 'utf8').trim() === '') {
    return ['README.md missing or empty'];
  }
  return [];
}

/**
 * Checks that the repository root states how to keep the documentation current.
 *
 * `README.md` must carry the block itself. The provider entry points `AGENTS.md` and
 * `CLAUDE.md` may carry it or may point at `README.md`, because a root entry point that is only
 * a pointer is the layout this gate wants and copying the block into three files would leave
 * three texts to drift apart.
 *
 * @param {string} root Absolute path to the repository root.
 * @returns {{file: string, reason: string}[]} Gaps, empty when the root states the rule once.
 */
export function auditMaintenance(root) {
  const gaps = [];
  const readme = join(root, 'README.md');
  if (!existsSync(readme)) gaps.push({ file: 'README.md', reason: 'file missing' });
  else if (!readFileSync(readme, 'utf8').includes(MAINTENANCE_MARKER)) {
    gaps.push({ file: 'README.md', reason: `no ${MAINTENANCE_MARKER} block` });
  }

  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    const file = join(root, name);
    if (!existsSync(file)) {
      gaps.push({ file: name, reason: 'file missing' });
      continue;
    }
    const text = readFileSync(file, 'utf8');
    if (!text.includes(MAINTENANCE_MARKER) && !text.includes('README.md')) {
      gaps.push({ file: name, reason: `no ${MAINTENANCE_MARKER} block and no README.md reference` });
    }
  }
  return gaps;
}

/**
 * Runs the whole gate and returns its report.
 *
 * @param {object} options Parsed command line options.
 * @returns {object} The report written to stdout.
 */
export function runAudit(options) {
  const kinds = ['all', 'jsdoc', 'folders', 'maintenance'];
  if (!kinds.includes(options.kind)) {
    throw new Error(`--kind ${options.kind} is not one of ${kinds.join(', ')}`);
  }

  const root = resolve(options.root ?? process.cwd());
  const files = discoverSourceFiles(root, options.roots, options.excludes);
  const scoped = options.dir
    ? files.filter((file) => file.startsWith(resolve(root, options.dir) + sep))
    : files;

  if (files.length === 0) {
    throw new Error(
      'found no JavaScript or TypeScript source files — this gate covers JS and TS repositories only',
    );
  }
  if (options.dir && scoped.length === 0) {
    throw new Error(
      `--dir ${options.dir} matched no source files — check the path, or drop --dir to scan the repository`,
    );
  }

  const gaps = { jsdoc: [], folders: [], maintenance: [] };
  const wants = (kind) => options.kind === 'all' || options.kind === kind;

  if (wants('jsdoc')) {
    const ts = loadTypeScript(root);
    if (!ts) {
      throw new Error(
        'typescript is not installed in this repository — run `npm install --save-dev typescript`',
      );
    }
    for (const file of scoped) {
      const rel = relative(root, file).split(sep).join('/');
      if (!options.includeTests && TEST_PATTERN.test(rel)) continue;
      let text;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      for (const gap of auditDeclarations(ts, rel, text)) gaps.jsdoc.push({ file: rel, ...gap });
    }
  }

  const folders = [...new Set(scoped.map((file) => file.slice(0, file.lastIndexOf(sep))))].sort();
  if (wants('folders')) {
    for (const dir of folders) {
      const reasons = auditFolder(dir);
      if (reasons.length > 0) {
        gaps.folders.push({ dir: relative(root, dir).split(sep).join('/') || '.', missing: reasons });
      }
    }
  }
  if (wants('maintenance') && !options.dir) gaps.maintenance = auditMaintenance(root);

  const limited = {};
  for (const [kind, list] of Object.entries(gaps)) {
    limited[kind] = options.limit > 0 ? list.slice(0, options.limit) : list;
  }

  const counts = {
    jsdoc: gaps.jsdoc.length,
    folders: gaps.folders.length,
    maintenance: gaps.maintenance.length,
    filesScanned: scoped.length,
    foldersScanned: folders.length,
  };
  return { ok: counts.jsdoc + counts.folders + counts.maintenance === 0, counts, gaps: limited };
}

/**
 * Parses the command line and prints the report.
 *
 * @returns {number} The process exit code.
 */
function main() {
  const { values, positionals } = parseArgs({
    options: {
      root: { type: 'string' },
      dir: { type: 'string' },
      kind: { type: 'string', default: 'all' },
      exclude: { type: 'string', multiple: true, default: [] },
      'include-tests': { type: 'boolean', default: false },
      limit: { type: 'string', default: '0' },
      out: { type: 'string', short: 'o' },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const report = runAudit({
    root: values.root,
    roots: positionals,
    dir: values.dir,
    kind: values.kind,
    excludes: values.exclude,
    includeTests: values['include-tests'],
    limit: Number(values.limit),
  });

  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (values.out) writeFileSync(values.out, json);
  else process.stdout.write(json);

  const { counts } = report;
  process.stderr.write(
    `docs-audit: ${counts.jsdoc} undocumented declarations, ${counts.folders} folders missing docs, ` +
      `${counts.maintenance} root gaps (${counts.filesScanned} files, ${counts.foldersScanned} folders)\n`,
  );
  return report.ok ? 0 : 1;
}

/** Usage text. It is the single description of the gate's contract for humans and agents. */
const HELP = `Usage: node docs-audit.mjs [roots...] [options]

Fails while any declaration lacks JSDoc, any source folder lacks a non-empty README.md, or the
root README.md lacks the upkeep block that AGENTS.md and CLAUDE.md point at.

  [roots...]         Directories to scan. Default: every non-ignored source file in the repo.
  --root <dir>       Repository root. Default: the current directory.
  --dir <dir>        Scope the whole report to one folder. Use it to work through a backlog.
  --kind <k>         all (default) | jsdoc | folders | maintenance
  --exclude <frag>   Extra path fragment to skip. Repeatable.
  --include-tests    Apply the JSDoc rule to test and mock files as well.
  --limit <n>        Cap each gap list. Counts stay exact.
  -o, --out <file>   Write the JSON report to a file instead of stdout.
  -h, --help         This text.

Exit codes: 0 = clean, 1 = gaps found, 2 = the gate could not run.
`;

// `file://${argv[1]}` does not survive a space in the path or a Windows drive letter, and a
// gate that silently declines to run is worse than no gate at all.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`docs-audit: ${error.message}\n`);
    process.exitCode = 2;
  }
}
