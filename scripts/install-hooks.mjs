#!/usr/bin/env node
// Registers the versioned git hooks (.githooks) for this clone. Runs after
// `npm install` via the `prepare` script; a silent no-op outside a git checkout.
import { execFileSync } from 'node:child_process';

try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
  execFileSync('git', ['config', 'core.hooksPath', '.githooks']);
  console.log('git hooks installed: commits and pushes now require `npm run verify` to pass');
} catch {
  /* not a git checkout */
}
