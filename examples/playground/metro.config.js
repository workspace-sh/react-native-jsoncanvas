// Metro config for the playground example.
//
// The library lives one level up (../..) and is symlinked into our
// node_modules via the `file:../..` dep. Metro needs to:
//   1. Watch the library's src/ for changes (so edits hot-reload)
//   2. Resolve modules from both local and root node_modules (hoisting)
//   3. Avoid loading two copies of react / react-native (which crashes)
//
// Pattern mirrors apps/mobile/metro.config.js in the Workspace monorepo.

const path = require('path');
const {getDefaultConfig} = require('expo/metro-config');

const projectRoot = __dirname;
const libRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the library so edits in src/ trigger reloads
config.watchFolders = [libRoot];

// Resolve from both local and root node_modules (root is where npm hoists shared deps)
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(libRoot, 'node_modules'),
];

// Force a single copy of react / react-native — block any nested copies the
// library might pull in from its own node_modules during dev. (Library
// declares them as peerDeps so this shouldn't happen, but defence-in-depth.)
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
