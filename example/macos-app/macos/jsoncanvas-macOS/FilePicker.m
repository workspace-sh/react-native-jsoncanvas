// Example-app-local native module for opening .canvas files via NSOpenPanel.
//
// Deliberately NOT in the library — file IO is a consumer-app concern, not
// a renderer concern. The library exposes `<CanvasView content=... />` as a
// pure-string-in interface; loading files is whatever the host wants it to
// be (NSOpenPanel here, Open dialog on Web, document picker on iOS, etc.).
//
// Written in Objective-C rather than Swift because Swift in the app target
// requires a bridging header + `SWIFT_OBJC_BRIDGING_HEADER` build setting,
// and that's bookkeeping the harness doesn't need to carry. (The library's
// own Swift is fine — it's compiled into a Pod, different mechanism.)
//
// Returns the file contents directly so JS never touches the filesystem.
// `path` is included so consumers can derive a `basePath` for resolving
// relative image references inside the canvas.

#import <React/RCTBridgeModule.h>
#import <AppKit/AppKit.h>

@interface FilePicker : NSObject <RCTBridgeModule>
@end

@implementation FilePicker

RCT_EXPORT_MODULE();

// Threading: NSOpenPanel.runModal must run on the main thread. RN dispatches
// native module methods on a background queue by default; this `methodQueue`
// override pins us to the main queue so we don't have to hop ourselves.
- (dispatch_queue_t)methodQueue {
  return dispatch_get_main_queue();
}

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

RCT_EXPORT_METHOD(openCanvasFiles:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
  NSOpenPanel *panel = [NSOpenPanel openPanel];
  panel.title = @"Open JSON Canvas Files";
  panel.allowsMultipleSelection = YES;
  panel.canChooseDirectories = NO;
  panel.canChooseFiles = YES;
  // `.canvas` is the official Obsidian-style extension; also accept `.json`
  // so users can drop a hand-crafted JSON file matching the schema.
  panel.allowedFileTypes = @[@"canvas", @"json"];

  if ([panel runModal] != NSModalResponseOK) {
    resolve(@[]);
    return;
  }

  NSMutableArray *results = [NSMutableArray array];
  for (NSURL *url in panel.URLs) {
    NSError *error = nil;
    NSString *content = [NSString stringWithContentsOfURL:url
                                                 encoding:NSUTF8StringEncoding
                                                    error:&error];
    if (content == nil) {
      // Skip files that fail to read but continue with the rest —
      // multi-select shouldn't fail wholesale on one bad file.
      NSLog(@"[FilePicker] failed to read %@: %@", url.path, error);
      continue;
    }
    [results addObject:@{
      @"path": url.path,
      @"name": url.lastPathComponent,
      @"content": content,
    }];
  }
  resolve(results);
}

@end
