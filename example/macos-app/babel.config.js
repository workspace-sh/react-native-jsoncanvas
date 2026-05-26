// Babel config for the bare RN + react-native-macos harness.
//
// '@babel/plugin-transform-export-namespace-from' is required because the
// library's markdown rendering pipeline pulls in the syntax-tree ecosystem
// (parse5 → hast-util-from-html), which uses ES2020 `export * as foo from
// 'bar'` syntax that RN's preset doesn't transform by default. Same plugin
// list as Workspace's apps/desktop.

module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    '@babel/plugin-transform-export-namespace-from',
    'react-native-reanimated/plugin',
  ],
};
