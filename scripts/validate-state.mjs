#!/usr/bin/env node
// Integrity check for .enigma/. Runs at the start of every Enigma command.
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  enigmaDir, readJson, readJsonl, envelopeErrors, parseArgs, isMain,
} from './lib/enigma.mjs';

const KINDS = ['teams', 'people', 'projects', 'components'];

export async function validateState(root) {
  const dir = enigmaDir(root);
  const errors = [];
  const warnings = [];

  try {
    await fs.stat(dir);
  } catch {
    return { ok: false, errors: ['no .enigma directory — run /enigma:init'], warnings };
  }

  const mapIds = new Set();
  const perKind = {};
  for (const kind of KINDS) {
    const file = path.join(dir, 'map', `${kind}.json`);
    try {
      const list = await readJson(file, []);
      perKind[kind] = list;
      const seen = new Set();
      for (const e of list) {
        if (seen.has(e.id)) errors.push(`${kind}.json: duplicate id "${e.id}"`);
        seen.add(e.id);
        mapIds.add(e.id);
      }
    } catch (err) {
      errors.push(err.message); // includes file path, e.g. corrupt components.json
      perKind[kind] = [];
    }
  }

  let rels = [];
  try {
    rels = await readJson(path.join(dir, 'map', 'relationships.json'), []);
  } catch (err) {
    errors.push(err.message);
  }
  rels.forEach((r, i) => {
    if (!mapIds.has(r.from)) errors.push(`relationships.json[${i}]: unknown "from" ${r.from}`);
    if (!mapIds.has(r.to)) errors.push(`relationships.json[${i}]: unknown "to" ${r.to}`);
    errors.push(...envelopeErrors(r.provenance, `relationships.json[${i}].provenance`));
  });

  const factsFile = path.join(dir, 'memory', 'facts.jsonl');
  try {
    (await readJsonl(factsFile)).forEach((f, i) => {
      errors.push(...envelopeErrors(f, `facts.jsonl:${i + 1}`));
    });
  } catch (err) {
    errors.push(err.message);
  }

  let ledgerEntities = new Set();
  try {
    ledgerEntities = new Set((await readJsonl(path.join(dir, 'ledger', 'changes.jsonl'))).map((e) => e.entity));
  } catch (err) {
    errors.push(err.message);
  }
  for (const kind of KINDS) {
    for (const e of perKind[kind]) {
      if (!ledgerEntities.has(e.id)) {
        errors.push(`${kind}.json: "${e.id}" has no ledger entry — map was mutated outside the ledger`);
      }
    }
  }

  if (!(await readJson(path.join(dir, 'index', 'sources.json'), null))) {
    warnings.push('index/sources.json missing — harness discovery has not run');
  }

  return { ok: errors.length === 0, errors, warnings };
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const result = await validateState(typeof args.dir === 'string' ? args.dir : process.cwd());
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}
