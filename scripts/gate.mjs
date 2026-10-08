#!/usr/bin/env node
// Local enforcement of the CI gates. Called by .githooks/pre-commit and
// .githooks/pre-push: nothing is committed or pushed unless `npm run verify`
// passed on exactly the tree being committed or pushed. CI runs the same
// command, so a green local gate means a green pipeline.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const stamp = git('rev-parse', '--git-path', 'verified-tree'); // tree hash that last passed verify
const lastVerified = () => (existsSync(stamp) ? readFileSync(stamp, 'utf8').trim() : '');
const die = (msg) => { console.error(`\ngate: ${msg}\n`); process.exit(1); };

// The tree CI will see is the committed one, so the working tree must match it.
function requireCleanTree() {
  const dirty = spawnSync('git', ['diff', '--quiet']).status !== 0;
  const untracked = git('ls-files', '--others', '--exclude-standard');
  if (dirty) die('unstaged changes: stage them (git add) or stash them, so that what is verified is what is committed');
  if (untracked) die(`untracked files would be missing from CI:\n${untracked}\nStage them (git add) or remove them.`);
}

function verify() {
  console.log('gate: running `npm run verify` (the same command CI runs)...');
  const r = spawnSync('npm', ['run', 'verify'], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) die('verify failed: fix the problems above; nothing was committed/pushed');
}

const hook = process.argv[2];
if (hook === 'pre-commit') {
  requireCleanTree();
  verify();
  writeFileSync(stamp, git('write-tree')); // tree of the commit about to be created
  console.log('gate: verify passed; commit allowed');
} else if (hook === 'pre-push') {
  const head = git('rev-parse', 'HEAD');
  const lines = readFileSync(0, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    const [, sha] = line.split(' ');
    if (/^0+$/.test(sha)) continue; // deleting a remote ref
    const tree = git('rev-parse', `${sha}^{tree}`);
    if (tree === lastVerified()) continue;
    if (sha !== head) die(`${sha.slice(0, 8)} has not been verified and is not checked out. Check it out and run \`npm run verify\`.`);
    requireCleanTree();
    verify();
    writeFileSync(stamp, tree);
  }
  console.log('gate: every pushed commit has passed verify; push allowed');
} else {
  die('usage: gate.mjs <pre-commit|pre-push>');
}
