// Metro config for the Expo CNG example. Pattern mirrors
// react-native-source-editor/example/expo-app/metro.config.js — the proven
// shape for an Expo app consuming a sibling library via `file:../..`.

const {getDefaultConfig} = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const moduleRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// iOS + Android only here. Web smoke-testing is tracked in #17 — Skia for
// web pulls in CanvasKit WASM with its own bundling caveats, kept off the
// happy path until that issue lands.
config.resolver.platforms = ['ios', 'android', 'native'];

// Block the library's own copies of react / react-native so Metro can't
// load two react roots (one from us, one from the library) and crash.
//
// Important: the regex MUST be anchored at a path boundary, otherwise
// `node_modules/react` also matches `node_modules/react-is`,
// `node_modules/react-dom`, `node_modules/react-native-anything`, etc. —
// every sibling that happens to start with "react". That breaks transitive
// resolution (hoist-non-react-statics → react-is) and surfaces as confusing
// "unable to resolve react-is" Metro errors.
//
// Trailing `/` guarantees we only match the actual react/ and react-native/
// package directories, not name-prefixed siblings.
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const reactPath = escapeRegExp(path.resolve(moduleRoot, 'node_modules', 'react'));
const rnPath = escapeRegExp(path.resolve(moduleRoot, 'node_modules', 'react-native'));
config.resolver.blockList = [
  ...Array.from(config.resolver.blockList ?? []),
  new RegExp(reactPath + '/'),
  new RegExp(rnPath + '/'),
];

// Resolve from both local and module root node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(moduleRoot, 'node_modules'),
];

// Explicit override — bypass any symlink resolution quirks
config.resolver.extraNodeModules = {
  '@workspace.sh/react-native-jsoncanvas': moduleRoot,
};

// Watch the library so src/ edits hot-reload
config.watchFolders = [moduleRoot];

module.exports = config;
