#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  // `moduleName` must match `AppRegistry.registerComponent(...)` on the JS
  // side (driven by `name` in app.json) — keep this in sync with index.js,
  // not with the display name.
  self.moduleName = @"jsoncanvas";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};
  self.dependencyProvider = [RCTAppDependencyProvider new];

  [super applicationDidFinishLaunching:notification];

  // `RCTAppDelegate` defaults the window title to `self.moduleName`
  // (RCTAppDelegate.mm:86) so the titlebar would otherwise read
  // "jsoncanvas". Override here with the human-facing display name —
  // sourced from `CFBundleName` (which mirrors `displayName` in
  // app.json) to keep JS and native in sync.
  NSString *displayName =
      [[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleName"];
  if (displayName.length > 0) {
    self.window.title = displayName;
  }
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  [[RCTBundleURLProvider sharedSettings] setJsLocation:@"localhost:8082"];
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

/// This method controls whether the `concurrentRoot`feature of React18 is turned on or off.
///
/// @see: https://reactjs.org/blog/2022/03/29/react-v18.html
/// @note: This requires to be rendering on Fabric (i.e. on the New Architecture).
/// @return: `true` if the `concurrentRoot` feature is enabled. Otherwise, it returns `false`.
- (BOOL)concurrentRootEnabled
{
#ifdef RN_FABRIC_ENABLED
  return true;
#else
  return false;
#endif
}

@end
