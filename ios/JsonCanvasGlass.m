// Liquid Glass for React Native on the Mac, which has none of its own:
// - JsonCanvasGlass: glass behind a view (the minimap's default background).
//   NSGlassEffectView from macOS 26, a visual effect view before it.
// - JsonCanvasGlassButton: the system's own glass button (NSButton with the
//   glass bezel from macOS 26), an SF Symbol in it, for a canvas's controls.

#if TARGET_OS_OSX

#import <AppKit/AppKit.h>
#import <React/RCTViewManager.h>

@interface JsonCanvasGlassView : NSView
@property (nonatomic, assign) CGFloat cornerRadius;
@end

@implementation JsonCanvasGlassView {
  NSView *_glass;
}

- (instancetype)initWithFrame:(NSRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    self.wantsLayer = YES;
    Class glassClass = NSClassFromString(@"NSGlassEffectView");
    if (glassClass != nil) {
      _glass = [[glassClass alloc] initWithFrame:self.bounds];
    } else {
      NSVisualEffectView *effect = [[NSVisualEffectView alloc] initWithFrame:self.bounds];
      effect.material = NSVisualEffectMaterialHUDWindow;
      effect.blendingMode = NSVisualEffectBlendingModeWithinWindow;
      effect.state = NSVisualEffectStateActive;
      effect.wantsLayer = YES;
      effect.layer.masksToBounds = YES;
      _glass = effect;
    }
    _glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    // Behind whatever React Native puts in this view.
    [self addSubview:_glass positioned:NSWindowBelow relativeTo:nil];
    self.cornerRadius = 10;
  }
  return self;
}

- (void)setCornerRadius:(CGFloat)cornerRadius
{
  _cornerRadius = cornerRadius;
  if ([_glass respondsToSelector:@selector(setCornerRadius:)]) {
    [(id)_glass setCornerRadius:cornerRadius];
  } else {
    _glass.layer.cornerRadius = cornerRadius;
  }
}

- (void)layout
{
  [super layout];
  _glass.frame = self.bounds;
  // React Native adds its children after the glass: keep the glass at the back.
  if (self.subviews.firstObject != _glass) {
    [_glass removeFromSuperview];
    [self addSubview:_glass positioned:NSWindowBelow relativeTo:nil];
  }
}

@end

@interface JsonCanvasGlassManager : RCTViewManager
@end

@implementation JsonCanvasGlassManager

RCT_EXPORT_MODULE(JsonCanvasGlass)

- (RCTPlatformView *)view
{
  return [[JsonCanvasGlassView alloc] initWithFrame:NSZeroRect];
}

RCT_EXPORT_VIEW_PROPERTY(cornerRadius, CGFloat)

@end

@interface JsonCanvasGlassButton : NSButton
@property (nonatomic, copy) NSString *symbol;
@property (nonatomic, copy) NSString *help;
@property (nonatomic, copy) RCTBubblingEventBlock onGlassPress;
@end

@implementation JsonCanvasGlassButton

- (instancetype)initWithFrame:(NSRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    self.title = @"";
    self.imagePosition = NSImageOnly;
    self.target = self;
    self.action = @selector(pressed);
    if (@available(macOS 26.0, *)) {
      self.bezelStyle = NSBezelStyleGlass;
      self.borderShape = NSControlBorderShapeCircle;
    } else {
      self.bezelStyle = NSBezelStyleCircular;
    }
  }
  return self;
}

- (void)setSymbol:(NSString *)symbol
{
  _symbol = [symbol copy];
  NSImage *image = [NSImage imageWithSystemSymbolName:symbol accessibilityDescription:_help];
  NSImageSymbolConfiguration *config = [NSImageSymbolConfiguration configurationWithPointSize:13 weight:NSFontWeightMedium];
  self.image = [image imageWithSymbolConfiguration:config];
}

- (void)setHelp:(NSString *)help
{
  _help = [help copy];
  self.toolTip = help;
  [self setAccessibilityLabel:help];
}

- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }

- (void)pressed
{
  if (_onGlassPress) _onGlassPress(@{});
}

@end

@interface JsonCanvasGlassButtonManager : RCTViewManager
@end

@implementation JsonCanvasGlassButtonManager

RCT_EXPORT_MODULE(JsonCanvasGlassButton)

- (RCTPlatformView *)view
{
  return [[JsonCanvasGlassButton alloc] initWithFrame:NSZeroRect];
}

RCT_EXPORT_VIEW_PROPERTY(symbol, NSString)
RCT_EXPORT_VIEW_PROPERTY(help, NSString)
RCT_EXPORT_VIEW_PROPERTY(onGlassPress, RCTBubblingEventBlock)

@end

#endif
