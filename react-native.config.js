// React Native autolinking config — intentionally minimal.
//
// An earlier version declared
//   dependency: { platforms: { ios: null, android: null } }
// to signal "we have no iOS/Android native code". The macOS autolinker
// reads the same config and interprets the `ios: null` exclusion as
// "exclude from all platforms", silently dropping us from `pod install`
// on macOS too. Empty default is the safe shape — `react-native-macos`'s
// autolinker finds our podspec at the repo root and includes it for
// macOS targets only (the podspec itself declares
// `s.platforms = { :osx => '11.0' }`, so CocoaPods skips it on iOS).

module.exports = {};
