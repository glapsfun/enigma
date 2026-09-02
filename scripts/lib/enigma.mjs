// Shared primitives for Enigma's deterministic scripts.
// Node stdlib only — no npm dependencies (global constraint).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export const nowIso = () => new Date().toISOString();

export function enigmaDir(root = process.cwd()) {
  return path.join(root, '.enigma');
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`cannot read JSON ${file}: ${err.message}`);
  }
}

export async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

export async function appendJsonl(file, obj) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(obj)}\n`);
}

export async function readJsonl(file) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  // Number lines before dropping blanks so the error points at the real line.
  return text.split('\n')
    .map((line, i) => [line, i + 1])
    .filter(([line]) => Boolean(line))
    .map(([line, lineNo]) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`${file}:${lineNo} is not valid JSON`);
      }
    });
}

const STATUSES = ['FACT', 'INFERENCE', 'ASSUMPTION', 'UNKNOWN'];

export function envelopeErrors(env, where = 'envelope') {
  if (!env || typeof env !== 'object') return [`${where}: not an object`];
  const errors = [];
  if (!STATUSES.includes(env.status)) {
    errors.push(`${where}: status must be one of ${STATUSES.join('|')}`);
  }
  if (!env.source || typeof env.source.type !== 'string') {
    errors.push(`${where}: source.type is required`);
  }
  if (typeof env.confidence !== 'number' || env.confidence < 0 || env.confidence > 1) {
    errors.push(`${where}: confidence must be a number in 0..1`);
  }
  if (typeof env.observed_at !== 'string' || Number.isNaN(Date.parse(env.observed_at))) {
    errors.push(`${where}: observed_at must be an ISO-8601 string`);
  }
  return errors;
}

export function parseArgs(argv, booleanFlags = []) {
  const booleans = new Set(booleanFlags);
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (booleans.has(key) || next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

export function isMain(importMetaUrl) {
  return Boolean(process.argv[1]) && importMetaUrl === pathToFileURL(process.argv[1]).href;
}

export function sha256Hex(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export const STOPWORDS = new Set([
  'a', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can',
  'do', 'does', 'for', 'from', 'had', 'has', 'have', 'he', 'her', 'his', 'how',
  'if', 'in', 'into', 'is', 'it', 'its', 'may', 'more', 'no', 'not', 'of', 'on',
  'only', 'or', 'other', 'our', 'out', 'over', 'she', 'should', 'so', 'some',
  'such', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'to', 'up', 'was', 'we', 'were', 'what', 'when', 'which',
  'who', 'why', 'will', 'with', 'would', 'you', 'your',
]);

export function tokenize(text) {
  if (typeof text !== 'string') return [];
  return text.toLowerCase().split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function evidenceId(sourceType, contentHash) {
  return `${sourceType}-${String(contentHash).slice(0, 8)}`;
}

export function evidenceFileFor(root, id) {
  const cut = id.lastIndexOf('-');
  const type = cut > 0 ? id.slice(0, cut) : 'unknown';
  return path.join(enigmaDir(root), 'evidence', type, `${id}.json`);
}

export async function readEvidence(root) {
  const evDir = path.join(enigmaDir(root), 'evidence');
  let dirents;
  try {
    dirents = await fs.readdir(evDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const items = [];
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    for (const name of await fs.readdir(path.join(evDir, d.name))) {
      if (!name.endsWith('.json')) continue;
      items.push(await readJson(path.join(evDir, d.name, name)));
    }
  }
  return items;
}
