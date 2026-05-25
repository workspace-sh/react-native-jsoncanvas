// React Native autolinking config.
//
// The library currently ships native code for macOS only (a smartMagnify
// event bridge — see ios/WorkspaceJsonCanvasGesture.swift). We declare iOS
// / Android as having no platform-specific native code so the autolinker
// doesn't try to integrate anything there. The macOS Pod is picked up via
// react-native-jsoncanvas.podspec at the repo root.

module.exports = {
  dependency: {
    platforms: {
      ios: null,
      android: null,
    },
  },
};
