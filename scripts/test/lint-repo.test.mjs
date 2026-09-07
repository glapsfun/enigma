import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJson } from '../lib/enigma.mjs';
import { lintRepo } from '../dev/lint-repo.mjs';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const manifest = () => ({
  name: 'demo',
  description: 'A demo plugin.',
  version: '0.1.0',
  author: { name: 'demo' },
  homepage: 'https://example.com/demo',
  repository: 'https://example.com/demo',
  license: 'MIT',
  keywords: ['demo'],
});

const md = (front, body = '\nbody\n') => `---\n${front}\n---\n${body}`;

// A minimal tree that satisfies every check, so each test mutates exactly one thing.
async function healthyPlugin() {
  const root = await mkdtemp(path.join(tmpdir(), 'enigma-lint-'));
  const w = async (rel, text) => {
    await mkdir(path.join(root, path.dirname(rel)), { recursive: true });
    await writeFile(path.join(root, rel), text);
  };

  await writeJson(path.join(root, '.claude-plugin', 'plugin.json'), manifest());

  await w('commands/init.md', md(
    'description: Initialize the demo.\nargument-hint: "[--docs <path>]"',
    '\nRun `node ${CLAUDE_PLUGIN_ROOT}/scripts/demo.mjs --dir .`\n',
  ));
  await w('agents/demo-oracle.md', md('name: demo-oracle\ndescription: A lens.\ntools: Read, Grep, Glob'));
  await w('agents/scout.md', md('name: scout\ndescription: A scout.\ntools: Read, Grep, Glob, Bash'));

  await w('skills/demo-core/SKILL.md', md('name: demo-core\ndescription: Core invariants.'));
  await w('skills/demo-core/references/rubric.md', '# Rubric\n\nNo frontmatter here.\n');

  await w('scripts/demo.mjs', [
    "import path from 'node:path';",
    "import { isMain } from './lib/enigma.mjs';",
    'export function demo(root) { return path.basename(root); }',
    'if (isMain(import.meta.url)) { console.log(demo(process.cwd())); }',
    '',
  ].join('\n'));
  await w('scripts/lib/enigma.mjs', 'export const noop = () => {};\n');
  await w('scripts/test/demo.test.mjs', "import { demo } from '../demo.mjs';\ndemo('.');\n");

  await writeJson(path.join(root, 'evals', 'evals.json'), {
    skill_name: 'demo',
    evals: [{ id: 1, prompt: 'do a thing', expected_output: 'a thing happened', files: ['fixtures/demo'] }],
  });

  return { root, w };
}

const joined = (res) => res.errors.join('\n');

test('a healthy plugin tree lints clean', async () => {
  const { root } = await healthyPlugin();
  const res = await lintRepo(root);
  assert.deepEqual(res.errors, []);
  assert.equal(res.ok, true);
});

test('manifest with bad semver and empty description is an error', async () => {
  const { root } = await healthyPlugin();
  await writeJson(path.join(root, '.claude-plugin', 'plugin.json'), {
    ...manifest(), version: '0.1', description: '',
  });
  const res = await lintRepo(root);
  assert.equal(res.ok, false);
  assert.match(joined(res), /plugin\.json: version/);
  assert.match(joined(res), /plugin\.json: description/);
});

test('missing manifest metadata is warnings, not errors', async () => {
  const { root } = await healthyPlugin();
  await writeJson(path.join(root, '.claude-plugin', 'plugin.json'), {
    name: 'demo', description: 'A demo plugin.', version: '0.1.0', author: { name: 'demo' },
  });
  const res = await lintRepo(root);
  assert.deepEqual(res.errors, []);
  for (const key of ['homepage', 'repository', 'license', 'keywords']) {
    assert.match(res.warnings.join('\n'), new RegExp(`plugin\\.json:.*${key}`));
  }
});

test('an unknown manifest key is a warning', async () => {
  const { root } = await healthyPlugin();
  await writeJson(path.join(root, '.claude-plugin', 'plugin.json'), { ...manifest(), verison: '0.1.0' });
  const res = await lintRepo(root);
  assert.deepEqual(res.errors, []);
  assert.match(res.warnings.join('\n'), /plugin\.json: unknown key "verison"/);
});

test('a command without a description is an error', async () => {
  const { root, w } = await healthyPlugin();
  await w('commands/init.md', md('argument-hint: "[--x]"'));
  const res = await lintRepo(root);
  assert.equal(res.ok, false);
  assert.match(joined(res), /commands\/init\.md: description/);
});

test('an agent whose name does not match its filename is an error', async () => {
  const { root, w } = await healthyPlugin();
  await w('agents/demo-oracle.md', md('name: other-oracle\ndescription: A lens.\ntools: Read, Grep, Glob'));
  const res = await lintRepo(root);
  assert.equal(res.ok, false);
  assert.match(joined(res), /agents\/demo-oracle\.md: name "other-oracle"/);
});

test('an oracle granted a tool beyond Read, Grep, Glob is an error', async () => {
  const { root, w } = await healthyPlugin();
  await w('agents/demo-oracle.md', md('name: demo-oracle\ndescription: A lens.\ntools: Read, Write'));
  const res = await lintRepo(root);
  assert.equal(res.ok, false);
  assert.match(joined(res), /agents\/demo-oracle\.md: tools.*Write/);
});

test('scout may hold Bash without tripping the oracle rule', async () => {
  const { root } = await healthyPlugin();
  const res = await lintRepo(root);
  assert.ok(!joined(res).includes('scout.md'));
});

test('a skill whose name does not match its directory is an error', async () => {
  const { root, w } = await healthyPlugin();
  await w('skills/demo-core/SKILL.md', md('name: other-core\ndescription: Core.'));
  const res = await lintRepo(root);
  assert.equal(res.ok, false);
  assert.match(joined(res), /skills\/demo-core\/SKILL\.md: name "other-core"/);
});

test('a reference file with frontmatter is an error', async () => {
  const { root, w } = await healthyPlugin();
  await w('skills/demo-core/references/rubric.md', md('name: rubric', '\n# Rubric\n'));
  const res = await lintRepo(root);
  assert.equal(res.ok, false);
  assert.match(joined(res), /references\/rubric\.md: .*frontmatter/);
});

test('an unresolved CLAUDE_PLUGIN_ROOT reference is an error', async () => {
  const { root, w } = await healthyPlugin();
  await w('commands/init.md', md(
    'description: Initialize.\nargument-hint: "[--x]"',
    '\nRun `node ${CLAUDE_PLUGIN_ROOT}/scripts/ghost.mjs`\n',
  ));
  const res = await lintRepo(root);
  assert.equal(res.ok, false);
  assert.match(joined(res), /commands\/init\.md: .*scripts\/ghost\.mjs/);
});

test('directory and placeholder CLAUDE_PLUGIN_ROOT references still pass', async () => {
  const { root, w } = await healthyPlugin();
  await w('commands/init.md', md(
    'description: Initialize.\nargument-hint: "[--x]"',
    '\nScripts live in `${CLAUDE_PLUGIN_ROOT}/scripts/` and run as'
    + ' `node ${CLAUDE_PLUGIN_ROOT}/scripts/<name>.mjs`.\n'
    + 'Also `node ${CLAUDE_PLUGIN_ROOT}/scripts/demo.mjs`.\n',
  ));
  const res = await lintRepo(root);
  assert.deepEqual(res.errors, []);
});

test('a script missing its isMain guard or its exports is an error', async () => {
  const { root, w } = await healthyPlugin();
  await w('scripts/demo.mjs', "import path from 'node:path';\nconsole.log(path.sep);\n");
  const res = await lintRepo(root);
  assert.equal(res.ok, false);
  assert.match(joined(res), /scripts\/demo\.mjs: .*isMain\(import\.meta\.url\)/);
  assert.match(joined(res), /scripts\/demo\.mjs: .*export/);
});

test('a script imported by no test is an error', async () => {
  const { root } = await healthyPlugin();
  await rm(path.join(root, 'scripts', 'test', 'demo.test.mjs'));
  const res = await lintRepo(root);
  assert.equal(res.ok, false);
  assert.match(joined(res), /scripts\/demo\.mjs: not imported by any test/);
});

test('a script covered by a differently named test is a warning, not an error', async () => {
  const { root, w } = await healthyPlugin();
  await rm(path.join(root, 'scripts', 'test', 'demo.test.mjs'));
  await w('scripts/test/cycle.test.mjs', "import { demo } from '../demo.mjs';\ndemo('.');\n");
  const res = await lintRepo(root);
  assert.deepEqual(res.errors, []);
  assert.match(res.warnings.join('\n'), /scripts\/demo\.mjs: no scripts\/test\/demo\.test\.mjs/);
});

test('a bare import specifier in a script is an error', async () => {
  const { root, w } = await healthyPlugin();
  await w('scripts/demo.mjs', [
    "import lodash from 'lodash';",
    "import { isMain } from './lib/enigma.mjs';",
    'export const demo = () => lodash;',
    'if (isMain(import.meta.url)) { console.log(demo()); }',
    '',
  ].join('\n'));
  const res = await lintRepo(root);
  assert.equal(res.ok, false);
  assert.match(joined(res), /scripts\/demo\.mjs: .*"lodash"/);
});

test('commented-out bare imports do not fail the stdlib-only check', async () => {
  const { root, w } = await healthyPlugin();
  await w('scripts/demo.mjs', [
    "import { isMain } from './lib/enigma.mjs';",
    "export const demo = () => 'ok';",
    "// await import('lodash');",
    'if (isMain(import.meta.url)) { console.log(demo()); }',
    '',
  ].join('\n'));
  const res = await lintRepo(root);
  assert.deepEqual(res.errors, []);
  assert.equal(res.ok, true);
});
test('a stray package.json or lockfile is an error', async () => {
  const { root, w } = await healthyPlugin();
  await w('package.json', '{"name":"nope"}\n');
  await w('pnpm-lock.yaml', 'lockfileVersion: 9\n');
  const res = await lintRepo(root);
  assert.equal(res.ok, false);
  assert.match(joined(res), /package\.json: .*stdlib only/);
  assert.match(joined(res), /pnpm-lock\.yaml/);
});

test('unparseable json anywhere in the tree is an error', async () => {
  const { root, w } = await healthyPlugin();
  await w('fixtures/broken.json', '{not json\n');
  const res = await lintRepo(root);
  assert.equal(res.ok, false);
  assert.match(joined(res), /fixtures\/broken\.json/);
});

test('an empty evals array is an error and a case without files is a warning', async () => {
  const { root } = await healthyPlugin();
  await writeJson(path.join(root, 'evals', 'evals.json'), { skill_name: 'demo', evals: [] });
  const empty = await lintRepo(root);
  assert.equal(empty.ok, false);
  assert.match(joined(empty), /evals\/evals\.json: evals/);

  await writeJson(path.join(root, 'evals', 'evals.json'), {
    skill_name: 'demo',
    evals: [{ id: 1, prompt: 'p', expected_output: 'o' }],
  });
  const noFiles = await lintRepo(root);
  assert.deepEqual(noFiles.errors, []);
  assert.match(noFiles.warnings.join('\n'), /evals\.json: evals\[0\].*files/);
});

test('duplicate eval ids are an error', async () => {
  const { root } = await healthyPlugin();
  await writeJson(path.join(root, 'evals', 'evals.json'), {
    skill_name: 'demo',
    evals: [
      { id: 1, prompt: 'p', expected_output: 'o', files: ['f'] },
      { id: 1, prompt: 'q', expected_output: 'o', files: ['f'] },
    ],
  });
  const res = await lintRepo(root);
  assert.equal(res.ok, false);
  assert.match(joined(res), /evals\.json: duplicate id/);
});

test('an eval-prompt count in the docs that disagrees with evals.json is a warning', async () => {
  const { root, w } = await healthyPlugin();
  await w('CLAUDE.md', 'evals.json holds three eval prompts.\n');
  const res = await lintRepo(root);
  assert.deepEqual(res.errors, []);
  assert.match(res.warnings.join('\n'), /CLAUDE\.md: .*three eval prompts.*1/);
});

test('frontmatter the flat reader cannot model is a warning', async () => {
  const { root, w } = await healthyPlugin();
  await w('agents/demo-oracle.md', md(
    'name: demo-oracle\ndescription: A lens.\ntools: Read, Grep, Glob\nnested:\n  key: value',
  ));
  const res = await lintRepo(root);
  assert.match(res.warnings.join('\n'), /agents\/demo-oracle\.md: frontmatter line not understood/);
});

// The gate: node --test is itself the structural check for this repo.
test('the real repo lints clean', async () => {
  const res = await lintRepo(REPO_ROOT);
  assert.deepEqual(res.errors, []);
  assert.equal(res.ok, true);
});
