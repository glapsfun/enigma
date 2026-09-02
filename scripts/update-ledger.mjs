#!/usr/bin/env node
// Sole writer of .enigma/ledger/changes.jsonl (append-only history).
import path from 'node:path';
import { enigmaDir, appendJsonl, nowIso, parseArgs, isMain } from './lib/enigma.mjs';

export async function appendLedger(root, entry) {
  if (!entry || typeof entry.type !== 'string') throw new Error('ledger entry requires "type"');
  if (typeof entry.entity !== 'string') throw new Error('ledger entry requires "entity"');
  const record = { time: nowIso(), ...entry };
  await appendJsonl(path.join(enigmaDir(root), 'ledger', 'changes.jsonl'), record);
  return record;
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const root = typeof args.dir === 'string' ? args.dir : process.cwd();
  if (typeof args.entry !== 'string') {
    console.error('usage: update-ledger.mjs --dir <workspace> --entry \'<json>\'');
    process.exit(1);
  }
  try {
    console.log(JSON.stringify(await appendLedger(root, JSON.parse(args.entry))));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
