#!/usr/bin/env node
// Structural linter for the plugin repo itself: manifest shape, component
// frontmatter, cross-file references, script conventions, and the zero-npm
// rule. Developer tooling, not part of the .enigma pipeline.
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { parseArgs, isMain } from '../lib/enigma.mjs';

const SKIP_DIRS = new Set(['.git', '.enigma', 'docs', 'node_modules', '.github']);
const MANIFEST_KEYS = new Set([
  'name', 'description', 'version', 'author', 'homepage', 'repository', 'license', 'keywords',
]);
const RECOMMENDED_KEYS = ['homepage', 'repository', 'license', 'keywords'];
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ORACLE_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const LOCKFILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'];
const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

// Every path in a message is repo-relative, matching validate-state.mjs.
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

const exists = (p) => fs.stat(p).then(() => true, () => false);
const read = (p) => fs.readFile(p, 'utf8');

// Flat `key: value` frontmatter only — the whole repo uses nothing else.
// Anything this reader cannot model lands in `suspicious` so the caller warns
// rather than silently mis-parsing. Out of scope: block scalars, anchors,
// nested maps, multi-line lists.
export function frontmatter(text) {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  const data = {};
  const suspicious = [];
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line) || line.trimStart().startsWith('- ')) { suspicious.push(line); continue; }
    const cut = line.indexOf(':');
    if (cut === -1) { suspicious.push(line); continue; }
    let value = line.slice(cut + 1).trim();
    if (value.length > 1 && /^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1);
    data[line.slice(0, cut).trim()] = value;
  }
  return { data, suspicious };
}

// Static import/export are anchored to the start of a line: in ESM they can
// only appear there, and anchoring keeps an import statement quoted inside a
// test fixture string from reading as a real dependency.
const SPECIFIER_PATTERNS = [
  /^\s*import\s[^'"\n]*from\s*['"]([^'"]+)['"]/gm,
  /^\s*import\s*['"]([^'"]+)['"]/gm,
  /^\s*export\s[^'"\n]*from\s*['"]([^'"]+)['"]/gm,
  /^[^'"\n]*\bimport\s*\(\s*['"]([^'"]+)['"]/gm,
];

function importSpecifiers(source) {
  const found = [];
  for (const re of SPECIFIER_PATTERNS) {
    for (const m of source.matchAll(re)) found.push(m[1]);
  }
  return found;
}

export async function lintRepo(root) {
  const errors = [];
  const warnings = [];
  const files = await walk(root);
  const at = (file) => rel(root, file);
  const isUnder = (file, ...parts) => at(file).startsWith(parts.join('/') + '/');

  // --- manifest ------------------------------------------------------------
  const manifestPath = path.join(root, '.claude-plugin', 'plugin.json');
  let manifest = null;
  if (!(await exists(manifestPath))) {
    errors.push('.claude-plugin/plugin.json: missing — a plugin repo needs a manifest');
  } else {
    try {
      manifest = JSON.parse(await read(manifestPath));
    } catch (err) {
      errors.push(`.claude-plugin/plugin.json: ${err.message}`);
    }
  }
  if (manifest) {
    if (typeof manifest.name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(manifest.name)) {
      errors.push(`plugin.json: name must be lowercase kebab-case, got ${JSON.stringify(manifest.name)}`);
    }
    if (typeof manifest.description !== 'string' || !manifest.description.trim()) {
      errors.push('plugin.json: description is required and must be non-empty');
    }
    if (typeof manifest.version !== 'string' || !SEMVER.test(manifest.version)) {
      errors.push(`plugin.json: version must be semver, got ${JSON.stringify(manifest.version)}`);
    }
    const author = manifest.author;
    const authorOk = typeof author === 'string'
      ? Boolean(author.trim())
      : Boolean(author && typeof author === 'object' && typeof author.name === 'string' && author.name.trim());
    if (!authorOk) errors.push('plugin.json: author must be a name or an object with a name');
    for (const key of RECOMMENDED_KEYS) {
      if (manifest[key] === undefined) {
        warnings.push(`plugin.json: no "${key}" — public plugins should declare it`);
      }
    }
    for (const key of Object.keys(manifest)) {
      if (!MANIFEST_KEYS.has(key)) warnings.push(`plugin.json: unknown key "${key}" — typo?`);
    }
  }

  // --- markdown components -------------------------------------------------
  const markdown = files.filter((f) => f.endsWith('.md'));
  const frontmatterOf = new Map();
  for (const file of markdown) {
    const parsed = frontmatter(await read(file));
    frontmatterOf.set(file, parsed);
    if (parsed?.suspicious.length) {
      warnings.push(`${at(file)}: frontmatter line not understood by the flat reader — ${JSON.stringify(parsed.suspicious[0].trim())}`);
    }
  }

  const require = (file, parsed, keys) => {
    if (!parsed) {
      errors.push(`${at(file)}: no YAML frontmatter`);
      return false;
    }
    let ok = true;
    for (const key of keys) {
      if (typeof parsed.data[key] !== 'string' || !parsed.data[key].trim()) {
        errors.push(`${at(file)}: ${key} is required in frontmatter`);
        ok = false;
      }
    }
    return ok;
  };

  for (const file of markdown.filter((f) => isUnder(f, 'commands'))) {
    const parsed = frontmatterOf.get(file);
    if (require(file, parsed, ['description']) && !parsed.data['argument-hint']) {
      warnings.push(`${at(file)}: no argument-hint — commands that take arguments should declare one`);
    }
  }

  for (const file of markdown.filter((f) => isUnder(f, 'agents'))) {
    const parsed = frontmatterOf.get(file);
    if (!require(file, parsed, ['name', 'description', 'tools'])) continue;
    const stem = path.basename(file, '.md');
    if (parsed.data.name !== stem) {
      errors.push(`${at(file)}: name "${parsed.data.name}" does not match the filename "${stem}"`);
    }
    // Oracles and the judge reason over a handed-in bundle and never fetch data.
    if (/-oracle$/.test(stem) || stem === 'judge') {
      const extra = parsed.data.tools.split(',').map((t) => t.trim()).filter((t) => t && !ORACLE_TOOLS.has(t));
      if (extra.length) {
        errors.push(`${at(file)}: tools must be a subset of Read, Grep, Glob for oracles and the judge — remove ${extra.join(', ')}`);
      }
    }
  }

  for (const file of markdown.filter((f) => path.basename(f) === 'SKILL.md' && isUnder(f, 'skills'))) {
    const parsed = frontmatterOf.get(file);
    if (!require(file, parsed, ['name', 'description'])) continue;
    const dir = path.basename(path.dirname(file));
    if (parsed.data.name !== dir) {
      errors.push(`${at(file)}: name "${parsed.data.name}" does not match its directory "${dir}"`);
    }
  }

  for (const file of markdown.filter((f) => /^skills\/[^/]+\/references\//.test(at(f)))) {
    if (frontmatterOf.get(file)) {
      errors.push(`${at(file)}: reference files carry no frontmatter — they are progressive-disclosure targets, not skills`);
    }
  }

  // --- ${CLAUDE_PLUGIN_ROOT} cross-references ------------------------------
  // The character class stops at `<`, so the `scripts/<name>.mjs` placeholder
  // in CLAUDE.md degrades to the directory `scripts/` and resolves.
  for (const file of markdown) {
    const body = await read(file);
    for (const m of body.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g)) {
      const ref = m[1];
      const target = path.join(root, ref);
      if (ref.endsWith('/')) {
        if (!(await exists(target))) errors.push(`${at(file)}: reference to missing directory \${CLAUDE_PLUGIN_ROOT}/${ref}`);
      } else if (/\.(mjs|md|json)$/.test(ref)) {
        if (!(await exists(target))) errors.push(`${at(file)}: reference to missing file \${CLAUDE_PLUGIN_ROOT}/${ref}`);
      }
    }
  }

  // --- script conventions --------------------------------------------------
  const scripts = files.filter((f) => {
    const r = at(f);
    return r.startsWith('scripts/') && r.endsWith('.mjs')
      && !r.startsWith('scripts/lib/') && !r.startsWith('scripts/dev/') && !r.startsWith('scripts/test/');
  });
  const tests = files.filter((f) => at(f).startsWith('scripts/test/') && f.endsWith('.test.mjs'));
  const testSources = new Map();
  for (const file of tests) testSources.set(file, await read(file));

  for (const file of scripts) {
    const name = path.basename(file, '.mjs');
    const source = await read(file);
    if (!/^export /m.test(source)) {
      errors.push(`${at(file)}: exports nothing — every script exports its function so tests can import it`);
    }
    if (!source.includes('isMain(import.meta.url)')) {
      errors.push(`${at(file)}: no isMain(import.meta.url) CLI guard`);
    }
    const importedBy = [...testSources].filter(([, src]) => src.includes(`../${name}.mjs`));
    if (importedBy.length === 0) {
      errors.push(`${at(file)}: not imported by any test under scripts/test/`);
    } else if (!importedBy.some(([t]) => path.basename(t) === `${name}.test.mjs`)) {
      warnings.push(`${at(file)}: no scripts/test/${name}.test.mjs — covered by ${importedBy.map(([t]) => path.basename(t)).join(', ')}`);
    }
  }

  if (!(await exists(path.join(root, 'scripts', 'lib', 'enigma.mjs')))) {
    errors.push('scripts/lib/enigma.mjs: missing — shared primitives live here');
  }

  const referenced = markdown.length ? (await Promise.all(markdown.map(read))).join('\n') : '';
  for (const file of scripts) {
    if (!referenced.includes(`scripts/${path.basename(file)}`)) {
      warnings.push(`${at(file)}: not referenced from any markdown — is it still wired into a command?`);
    }
  }

  // --- zero-dependency posture --------------------------------------------
  for (const file of files.filter((f) => at(f).startsWith('scripts/') && f.endsWith('.mjs'))) {
    for (const spec of importSpecifiers(await read(file))) {
      if (!spec.startsWith('node:') && !spec.startsWith('./') && !spec.startsWith('../')) {
        errors.push(`${at(file)}: bare import "${spec}" — stdlib only, never add npm dependencies`);
      }
    }
  }
  for (const file of files) {
    const base = path.basename(file);
    if (base === 'package.json') {
      errors.push(`${at(file)}: no package.json in this repo — stdlib only, no install step`);
    } else if (LOCKFILES.includes(base)) {
      errors.push(`${at(file)}: lockfile committed — stdlib only, never add npm dependencies`);
    }
  }
  if (await exists(path.join(root, 'node_modules'))) {
    errors.push('node_modules/: present — stdlib only, there is nothing to install');
  }

  // --- json integrity ------------------------------------------------------
  for (const file of files.filter((f) => f.endsWith('.json'))) {
    try {
      JSON.parse(await read(file));
    } catch (err) {
      errors.push(`${at(file)}: ${err.message}`);
    }
  }

  // --- evals ---------------------------------------------------------------
  const evalsPath = path.join(root, 'evals', 'evals.json');
  let evals = null;
  if (!(await exists(evalsPath))) {
    errors.push('evals/evals.json: missing');
  } else {
    try {
      evals = JSON.parse(await read(evalsPath));
    } catch {
      // already reported by the JSON pass
    }
  }
  if (evals) {
    if (typeof evals.skill_name !== 'string' || !evals.skill_name.trim()) {
      errors.push('evals/evals.json: skill_name is required and must be non-empty');
    }
    if (!Array.isArray(evals.evals) || evals.evals.length === 0) {
      errors.push('evals/evals.json: evals must be a non-empty array');
    } else {
      const seen = new Set();
      evals.evals.forEach((e, i) => {
        const where = `evals/evals.json: evals[${i}]`;
        if (e?.id === undefined) errors.push(`${where} has no id`);
        else if (seen.has(e.id)) errors.push(`evals/evals.json: duplicate id ${JSON.stringify(e.id)}`);
        else seen.add(e.id);
        for (const key of ['prompt', 'expected_output']) {
          if (typeof e?.[key] !== 'string' || !e[key].trim()) errors.push(`${where}: ${key} is required`);
        }
        if (!Array.isArray(e?.files) || e.files.length === 0) {
          warnings.push(`${where}: no files — the eval does not say what it runs against`);
        }
      });
    }
  }

  // --- doc drift on the eval count ----------------------------------------
  const count = Array.isArray(evals?.evals) ? evals.evals.length : null;
  if (count !== null) {
    for (const name of ['CLAUDE.md', 'README.md']) {
      const file = path.join(root, name);
      if (!(await exists(file))) continue;
      for (const m of (await read(file)).matchAll(/\b(\w+)\s+eval prompts?\b/gi)) {
        const word = m[1].toLowerCase();
        const stated = NUMBER_WORDS[word] ?? (/^\d+$/.test(word) ? Number(word) : null);
        if (stated !== null && stated !== count) {
          warnings.push(`${name}: says "${m[0]}" but evals.json has ${count} — drop the count or update it`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const result = await lintRepo(typeof args.dir === 'string' ? args.dir : process.cwd());
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}
