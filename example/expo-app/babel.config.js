// Babel config for the Expo playground. Inspired by
// apps/mobile/babel.config.js in the Workspace monorepo.
//
// Why this exists: babel-preset-expo auto-detects react-native-worklets
// and react-native-reanimated babel plugins via its own module resolution.
// Under npm workspaces, this can pick a version different from what the
// app actually bundles at runtime — surfacing as a hard "Worklets babel
// plugin version mismatch" error at app startup.
//
// Fix: disable the preset's auto-detection and load the worklets babel
// plugin from this app's perspective. Node walks up from this file's
// directory, so it finds the same worklets module the app's runtime will,
// guaranteeing version alignment regardless of whether worklets is hoisted
// to the monorepo root or installed locally.

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        'babel-preset-expo',
        {
          // Disable auto-detection — we load the plugin explicitly below.
          worklets: false,
          reanimated: false,
        },
      ],
    ],
    plugins: [
      // Resolved by Node from this file's location, walking up node_modules.
      // Always lands on whichever copy of react-native-worklets the app's
      // runtime will actually load. No path.resolve(__dirname, ...) because
      // that would break under hoisting; this file's location is constant.
      require('react-native-worklets/plugin'),
    ],
  };
};
