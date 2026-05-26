#!/usr/bin/env node
// Postinstall: symlink hoisted React Native packages into this app's local
// node_modules, so pbxproj build scripts that hardcode relative paths
// (`../node_modules/<pkg>/...`) resolve correctly under npm workspaces.
//
// Why
//
// Bare-RN's Pod and target build scripts (hermes-engine's "Replace Hermes
// for the right configuration, if needed", the jsoncanvas-macOS target's
// "Bundle React Native code and images", etc.) hardcode relative paths
// from the macos/ dir into ../node_modules/<pkg>. Under npm workspaces,
// those packages frequently hoist out of the app's local node_modules and
// the script's relative path resolves to a non-existent file. xcodebuild
// then fails with PhaseScriptExecution errors before any source compiles.
//
// Workspace's apps/desktop avoids this because apps/mobile pins a different
// react-native major (0.83 vs 0.81), forcing npm to keep both local. Our
// example apps' pins happen to coexist at root, so we don't get the same
// accidental local install.
//
// Fix
//
// For each package listed in PACKAGES below, walk up node_modules
// ancestors to find whichever copy the monorepo resolved, and symlink it
// into this app's local node_modules. Idempotent — leaves real local
// installs alone, recreates stale symlinks on every npm install.
//
// Add packages to PACKAGES as new "package not found" errors surface from
// xcodebuild. The autolinker uses absolute paths for most native modules
// (gesture-handler, reanimated, worklets, skia) so they're not affected;
// only the build-phase scripts that bake in relative paths at the
// xcodeproj level need this workaround.

const fs = require('node:fs');
const path = require('node:path');

const PACKAGES = [
  // Required by hermes-engine's "Replace Hermes" Pod script
  'react-native',
  // Required by the jsoncanvas-macOS target's "Bundle React Native code and
  // images" build phase (react-native-xcode.sh)
  'react-native-macos',
  // Required for `npx react-native config` (the autolinker) to discover
  // the library's own native module (ios/WorkspaceJsonCanvasGesture.swift).
  // The package.json file: dep symlinks to the monorepo root, but npm
  // hoists that symlink to the repo's own node_modules — the autolinker
  // doesn't walk up, so the symlink has to exist locally for it to be
  // included in pod install.
  '@workspace.sh/react-native-jsoncanvas',
];

const appDir = path.resolve(__dirname, '..');

function findHoisted(packageName, startDir) {
  let dir = startDir;
  while (true) {
    const candidate = path.join(dir, 'node_modules', packageName);
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function linkOne(packageName) {
  const localPath = path.join(appDir, 'node_modules', packageName);

  // Already installed locally? (real directory, not a symlink we made)
  try {
    const stat = fs.lstatSync(localPath);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      console.log(`[link-hoisted-rn] ${packageName} is installed locally; nothing to do.`);
      return;
    }
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(localPath);
    }
  } catch (_) {
    // doesn't exist yet — fall through to create it
  }

  const hoisted = findHoisted(packageName, path.dirname(appDir));
  if (!hoisted) {
    console.error(
      `[link-hoisted-rn] could not find ${packageName} in any ancestor node_modules. ` +
        `Run \`npm install\` at the repo root first.`,
    );
    process.exit(1);
  }

  // For scoped packages (e.g. @shopify/react-native-skia), ensure the
  // @scope/ parent dir exists before creating the symlink inside it.
  fs.mkdirSync(path.dirname(localPath), {recursive: true});
  const relativeTarget = path.relative(path.dirname(localPath), hoisted);
  fs.symlinkSync(relativeTarget, localPath, 'dir');

  console.log(
    `[link-hoisted-rn] symlinked node_modules/${packageName} -> ${relativeTarget}`,
  );
}

for (const pkg of PACKAGES) {
  linkOne(pkg);
}
