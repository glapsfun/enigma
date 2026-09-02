#!/usr/bin/env node
// Integrity check for .enigma/. Runs at the start of every Enigma command.
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  enigmaDir, readJson, readJsonl, readEvidence, envelopeErrors, parseArgs, isMain,
} from './lib/enigma.mjs';
import { indexIsStale } from './build-index.mjs';

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

  let ledgerEntries = [];
  try {
    ledgerEntries = await readJsonl(path.join(dir, 'ledger', 'changes.jsonl'));
  } catch (err) {
    errors.push(err.message);
  }
  const ledgerEntities = new Set(ledgerEntries.map((e) => e.entity));
  const ledgerEvidenceIds = new Set(
    ledgerEntries.filter((e) => e.type === 'evidence.added').map((e) => e.change?.evidence),
  );
  for (const kind of KINDS) {
    for (const e of perKind[kind]) {
      if (!ledgerEntities.has(e.id)) {
        errors.push(`${kind}.json: "${e.id}" has no ledger entry — map was mutated outside the ledger`);
      }
    }
  }

  let evidence = [];
  try {
    evidence = await readEvidence(root);
  } catch (err) {
    errors.push(err.message);
  }
  for (const item of evidence) {
    const where = `evidence/${item.source?.type ?? 'unknown'}/${item.id}.json`;
    if (typeof item.summary !== 'string' || !item.summary) errors.push(`${where}: summary is required`);
    if (!Array.isArray(item.entities) || item.entities.length === 0) {
      errors.push(`${where}: entities must list at least one map id`);
    } else {
      for (const id of item.entities) {
        if (!mapIds.has(id)) errors.push(`${where}: unknown entity "${id}"`);
      }
    }
    if (!ledgerEvidenceIds.has(item.id)) {
      errors.push(`${where}: no ledger entry — evidence was written outside ingest-evidence.mjs`);
    }
  }

  const srcDoc = await readJson(path.join(dir, 'index', 'sources.json'), null);
  if (!srcDoc) {
    warnings.push('index/sources.json missing — harness discovery has not run');
  } else {
    for (const s of srcDoc.sources ?? []) {
      if (!['approved', 'excluded', 'limited'].includes(s.consent)) {
        warnings.push(`sources.json: "${s.id}" has no consent decision — run /enigma:init --reconsent`);
      }
    }
  }

  try {
    const discovery = await readJson(path.join(dir, 'state', 'discovery.json'), { sources: {}, queue: [] });
    (discovery.queue ?? []).forEach((q, i) => {
      if (!mapIds.has(q.area)) warnings.push(`discovery.json queue[${i}]: unknown area "${q.area}"`);
    });
  } catch (err) {
    errors.push(err.message);
  }

  if (await indexIsStale(root)) warnings.push('index stale — run build-index.mjs');

  return { ok: errors.length === 0, errors, warnings };
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const result = await validateState(typeof args.dir === 'string' ? args.dir : process.cwd());
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}
