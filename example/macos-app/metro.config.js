// Metro config for the bare RN + react-native-macos harness.
//
// React version isolation matters here: react-native-macos@0.81 pins
// react@19.1.4, while the Expo playground (example/expo-app) sits on
// react@19.2.0. If Metro pulled the root-hoisted react it'd crash on
// version mismatch. extraNodeModules + blockList force this app's
// pinned react to win every resolution. Pattern mirrors Workspace's
// apps/desktop/metro.config.js.

const path = require('path');
const escape = require('escape-string-regexp');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const projectRoot = __dirname;
const moduleRoot = path.resolve(projectRoot, '../..');

/** @type {import('@react-native/metro-config').MetroConfig} */
const config = {
  watchFolders: [moduleRoot],
  resolver: {
    resolverMainFields: ['react-native', 'browser', 'main'],
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(moduleRoot, 'node_modules'),
    ],
    // Force react resolution to this app's pinned 19.1.4 — never the
    // root-hoisted version (likely a different 19.x for the Expo playground).
    // react-native resolves to root, which is fine because react-native@0.81
    // is what we want everywhere.
    extraNodeModules: {
      react: path.resolve(projectRoot, 'node_modules/react'),
      'react-native': path.resolve(moduleRoot, 'node_modules/react-native'),
    },
    // Anchored at a trailing `/` so we only block the actual react/ package
    // directory, not name-prefixed siblings (react-is, react-dom, etc.) —
    // see example/expo-app/metro.config.js for the same gotcha and fix.
    blockList: [
      new RegExp(`${escape(moduleRoot)}/node_modules/react/`),
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
