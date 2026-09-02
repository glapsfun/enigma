#!/usr/bin/env node
// Records a checkpoint and marks sources as freshly scanned.
import path from 'node:path';
import { enigmaDir, readJson, writeJson, nowIso, parseArgs, isMain } from './lib/enigma.mjs';

export async function checkpoint(root, { label = 'checkpoint', note = '', scanned = [] } = {}) {
  const stateDir = path.join(enigmaDir(root), 'state');
  const cpFile = path.join(stateDir, 'checkpoints.json');
  const record = { time: nowIso(), label, note };
  const list = await readJson(cpFile, []);
  list.push(record);
  await writeJson(cpFile, list);

  if (scanned.length) {
    const dFile = path.join(stateDir, 'discovery.json');
    const discovery = await readJson(dFile, { sources: {} });
    discovery.sources ??= {};
    for (const id of scanned) {
      discovery.sources[id] = { ...(discovery.sources[id] ?? {}), last_scanned: record.time };
    }
    await writeJson(dFile, discovery);
  }
  return record;
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const root = typeof args.dir === 'string' ? args.dir : process.cwd();
  const scanned = typeof args.scanned === 'string' ? args.scanned.split(',').filter(Boolean) : [];
  const record = await checkpoint(root, {
    label: typeof args.label === 'string' ? args.label : 'checkpoint',
    note: typeof args.note === 'string' ? args.note : '',
    scanned,
  });
  console.log(JSON.stringify(record));
}
