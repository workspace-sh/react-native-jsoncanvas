#!/usr/bin/env node
// Postinstall: ensure `react-native` is resolvable at
// node_modules/react-native relative to this app's macos/Pods directory,
// even when npm has hoisted it to the monorepo root.
//
// Why: bare RN's Pod build scripts (notably hermes-engine's
// "Replace Hermes for the right configuration, if needed" phase) hardcode
// `$PODS_ROOT/../../node_modules/react-native/scripts/xcode/with-environment.sh`.
// Under npm workspaces, react-native often hoists out of the app's local
// node_modules and the script's relative path resolves to a non-existent
// file, causing xcodebuild to fail with PhaseScriptExecution errors before
// any source actually compiles.
//
// Fix: drop a symlink at example/macos-app/node_modules/react-native that
// points at whichever react-native the monorepo actually resolved. Idempotent
// — if a real install already exists locally, leave it alone.

const fs = require('node:fs');
const path = require('node:path');

const appDir = path.resolve(__dirname, '..');
const localRnPath = path.join(appDir, 'node_modules', 'react-native');

// Already installed locally? (real directory, not a symlink we made)
try {
  const stat = fs.lstatSync(localRnPath);
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    console.log('[link-hoisted-rn] react-native is installed locally; nothing to do.');
    process.exit(0);
  }
  // Existing symlink — clear it and re-create (handles npm install churn)
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(localRnPath);
  }
} catch (_) {
  // doesn't exist yet — fall through to create it
}

// Find the hoisted react-native by walking up node_modules ancestors.
function findHoisted(startDir) {
  let dir = startDir;
  while (true) {
    const candidate = path.join(dir, 'node_modules', 'react-native');
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const hoisted = findHoisted(path.dirname(appDir));
if (!hoisted) {
  console.error(
    '[link-hoisted-rn] could not find react-native in any ancestor node_modules. ' +
      'Run `npm install` at the repo root first.',
  );
  process.exit(1);
}

// Ensure local node_modules exists, then symlink.
fs.mkdirSync(path.dirname(localRnPath), {recursive: true});
const relativeTarget = path.relative(path.dirname(localRnPath), hoisted);
fs.symlinkSync(relativeTarget, localRnPath, 'dir');

console.log(`[link-hoisted-rn] symlinked node_modules/react-native -> ${relativeTarget}`);
