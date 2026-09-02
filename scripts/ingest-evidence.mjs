#!/usr/bin/env node
// Sole writer of .enigma/evidence/. Validates, dedups, and ledgers evidence items.
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import {
  enigmaDir, readJson, writeJson, parseArgs, isMain, evidenceId, evidenceFileFor,
} from './lib/enigma.mjs';
import { appendLedger } from './update-ledger.mjs';

const MAP_KINDS = ['teams', 'people', 'projects', 'components'];
const SOURCE_TYPES = ['jira', 'confluence', 'slack', 'github', 'repo', 'docs', 'user', 'cli', 'web'];
const ITEM_KINDS = ['page', 'ticket', 'epic', 'pr', 'readme', 'channel', 'webpage', 'cli-output'];

export async function ingestEvidence(root, items) {
  const dir = enigmaDir(root);
  const mapIds = new Set();
  for (const kind of MAP_KINDS) {
    for (const e of await readJson(path.join(dir, 'map', `${kind}.json`), [])) mapIds.add(e.id);
  }

  const errors = [];
  const prepared = [];
  (items ?? []).forEach((item, i) => {
    const where = `items[${i}]`;
    const before = errors.length;
    if (!item || typeof item !== 'object') {
      errors.push(`${where}: not an object`);
      return;
    }
    if (!item.source || !SOURCE_TYPES.includes(item.source.type)) {
      errors.push(`${where}: source.type must be one of ${SOURCE_TYPES.join('|')}`);
    }
    if (typeof item.title !== 'string' || !item.title) errors.push(`${where}: title is required`);
    if (!ITEM_KINDS.includes(item.kind)) {
      errors.push(`${where}: kind must be one of ${ITEM_KINDS.join('|')}`);
    }
    if (typeof item.summary !== 'string' || !item.summary) errors.push(`${where}: summary is required`);
    if (typeof item.fetched_at !== 'string' || Number.isNaN(Date.parse(item.fetched_at))) {
      errors.push(`${where}: fetched_at must be an ISO-8601 string`);
    }
    if (typeof item.content_hash !== 'string' || item.content_hash.length < 8) {
      errors.push(`${where}: content_hash must be a sha256 hex string`);
    }
    if (item.excerpts !== undefined && !Array.isArray(item.excerpts)) {
      errors.push(`${where}: excerpts must be an array`);
    } else {
      (item.excerpts ?? []).forEach((x, j) => {
        if (!x || typeof x.quote !== 'string' || !x.quote) {
          errors.push(`${where}.excerpts[${j}]: quote is required and must be verbatim source text`);
        }
      });
    }
    if (!Array.isArray(item.entities) || item.entities.length === 0) {
      errors.push(`${where}: entities must list at least one map id`);
    } else {
      for (const id of item.entities) {
        if (!mapIds.has(id)) {
          errors.push(`${where}: unknown entity "${id}" — add it to the map before ingesting its evidence`);
        }
      }
    }
    if (errors.length === before) {
      prepared.push({
        ...item,
        id: item.id ?? evidenceId(item.source.type, item.content_hash),
        topics: (item.topics ?? []).map((t) => String(t).toLowerCase()),
        excerpts: item.excerpts ?? [],
      });
    }
  });

  if (errors.length) return { ok: false, added: [], skipped: [], errors };

  const added = [];
  const skipped = [];
  for (const item of prepared) {
    const file = evidenceFileFor(root, item.id);
    let exists = true;
    try {
      await fsp.stat(file);
    } catch {
      exists = false;
    }
    if (exists) {
      skipped.push(item.id);
      continue;
    }
    await appendLedger(root, {
      type: 'evidence.added',
      entity: item.entities[0],
      source: item.source.type,
      change: { evidence: item.id, title: item.title, entities: item.entities },
    });
    await writeJson(file, item);
    added.push(item.id);
  }
  return { ok: true, added, skipped, errors: [] };
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const root = typeof args.dir === 'string' ? args.dir : process.cwd();
  if (typeof args.items !== 'string') {
    console.error('usage: ingest-evidence.mjs --dir <workspace> --items <file.json>');
    process.exit(1);
  }
  const parsed = await readJson(args.items);
  const items = Array.isArray(parsed) ? parsed : parsed?.evidence ?? [];
  const result = await ingestEvidence(root, items);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}
