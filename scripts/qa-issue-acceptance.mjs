#!/usr/bin/env node
/**
 * Strict QA gate for GitHub Issues #1 #2 #3.
 * Exit 0 only if automated acceptance + build are green.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: false });
  if (r.status !== 0) {
    process.exit(r.status || 1);
  }
}

console.log('=== chrome-md-editor Issue Acceptance Gate ===');
console.log('Issues under test: #1 local images, #2 session restore, #3 multi-instance/styles\n');

run('npm', ['test']);
run('npm', ['run', 'build']);

const manifest = JSON.parse(readFileSync(resolve(root, 'dist/manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const checks = [
  ['dist/manifest.json exists', existsSync(resolve(root, 'dist/manifest.json'))],
  ['dist/background.js exists', existsSync(resolve(root, 'dist/background.js'))],
  ['dist/src/editor.html exists', existsSync(resolve(root, 'dist/src/editor.html'))],
  ['version package==manifest', pkg.version === manifest.version],
  ['dist editor bundle exists', existsSync(resolve(root, 'dist/assets/editor.js'))],
];

const bg = readFileSync(resolve(root, 'dist/background.js'), 'utf8');
const editorHtml = readFileSync(resolve(root, 'dist/src/editor.html'), 'utf8');
checks.push(['built background multi-instance', bg.includes('?i=')]);
const contentScript = readFileSync(resolve(root, 'dist/content-script.js'), 'utf8');
checks.push(['built content-script per-instance file handoff', contentScript.includes('pendingFile_')]);
checks.push(['built help button', editorHtml.includes('btnHelp')]);
checks.push(['no styleGroup toolbar', !editorHtml.includes('styleGroup')]);

let failed = false;
console.log('\n--- dist contracts ---');
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed = true;
}

if (failed) {
  console.error('\nGATE FAILED');
  process.exit(1);
}

console.log(`
GATE PASSED (automated)

Manual Chrome checklist (must still run on a real profile):
  [ ] Load unpacked: ${resolve(root, 'dist')}
  [ ] Enable "Allow access to file URLs"
  [ ] #1 Open folder with images/ relative md → preview shows image
  [ ] #1 Edit preview text near image → source keeps relative path (not blob:)
  [ ] #2 Edit + close tab → reopen extension → content restored
  [ ] #3 Click extension icon twice → two editor tabs
  [ ] #3 Toolbar mark/center/sup/sub inserts visible HTML in source + preview
`);
process.exit(0);
