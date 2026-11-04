// The window buttons in full screen on macOS, as JetBrains Runtime keeps them for IntelliJ
// (AWTWindow.m, setWindowFullScreenControls): macOS hides the window's own until the pointer
// reaches the top of the screen, so real buttons, made by AppKit as the window's own are, go in
// the window where the window's sat: in its frame view, over the content. Not in the content view:
// Chromium's answers no hit test in the page's draggable regions (-[BridgedContentView hitTest:]),
// the toolbar under the buttons is one, and a click there becomes a window drag, which can't move a
// window in full screen ("Window move completed without beginning"). Until the pointer is over them they're grey circles
// (macOS's own look for an inactive window's), then close and zoom show as themselves; minimize
// stays grey, as it does nothing in full screen. The copies macOS shows with the menu bar are
// hidden, so they don't show twice. As leaving full screen starts, the buttons hide and macOS's
// copies come back, as JetBrains Runtime does it (windowWillExitFullScreen:); they're taken out
// once it's done.
//
// A Node-API module, loaded by the main process (fullscreen.ts); the window is given as Electron's
// getNativeWindowHandle(), a buffer holding its NSView. Built on macOS only (scripts/native.mjs).

#import <AppKit/AppKit.h>
#include <node_api.h>

/** Where the buttons sit, from the window's top left: Electron's trafficLightPosition (window.ts). */
static const CGFloat LEFT = 14;
static const CGFloat TOP = 13;
/** The grey circles' diameter, as JetBrains Runtime's. */
static const CGFloat CIRCLE = 12;

@interface CerebroFullScreenButtons : NSView
@property(nonatomic, strong) NSColor *colour;
@property(nonatomic) BOOL hovered;
/** Its window's "will exit full screen" observer. */
@property(nonatomic, strong) id leaving;
/** The row the buttons are in, filling it. */
@property(nonatomic, readonly) NSView *row;
@end

@implementation CerebroFullScreenButtons

- (NSView *)row {
  return self.subviews.firstObject;
}

- (void)mouseEntered:(NSEvent *)event {
  [self show:YES];
}

- (void)mouseExited:(NSEvent *)event {
  [self show:NO];
}

/** Shows close and zoom as themselves, or all three as grey circles. */
- (void)show:(BOOL)hovered {
  self.hovered = hovered;
  NSArray<NSView *> *buttons = self.row.subviews;
  if (buttons.count == 3) {
    buttons[0].hidden = !hovered;
    buttons[1].hidden = YES;
    buttons[2].hidden = !hovered;
  }
  [self setNeedsDisplay:YES];
}

- (void)drawRect:(NSRect)dirty {
  NSArray<NSView *> *buttons = self.row.subviews;
  if (buttons.count != 3) return;
  [(self.colour ?: [NSColor grayColor]) setFill];
  for (NSUInteger i = 0; i < 3; i++) {
    if (self.hovered && i != 1) continue;
    NSRect frame = buttons[i].frame;
    NSRect circle = NSMakeRect(NSMinX(frame) + (NSWidth(frame) - CIRCLE) / 2,
                               NSMinY(frame) + (NSHeight(frame) - CIRCLE) / 2, CIRCLE, CIRCLE);
    [[NSBezierPath bezierPathWithOvalInRect:circle] fill];
  }
}

@end

/** The window a handle names, or nil. */
static NSWindow *windowOf(napi_env env, napi_value handle) {
  void *data = NULL;
  size_t length = 0;
  bool isBuffer = false;
  if (napi_is_buffer(env, handle, &isBuffer) != napi_ok || !isBuffer) return nil;
  if (napi_get_buffer_info(env, handle, &data, &length) != napi_ok) return nil;
  if (length < sizeof(void *)) return nil;
  NSView *view = (__bridge NSView *)(*(void **)data);
  return view.window;
}

/** The view the buttons go in: the window's frame view, the content view's superview. */
static NSView *frameViewOf(NSWindow *window) {
  return window.contentView.superview;
}

static CerebroFullScreenButtons *buttonsIn(NSWindow *window) {
  for (NSView *view in frameViewOf(window).subviews) {
    if ([view isKindOfClass:[CerebroFullScreenButtons class]]) {
      return (CerebroFullScreenButtons *)view;
    }
  }
  return nil;
}

/** A colour given as #rrggbb, or nil. */
static NSColor *colourOf(napi_env env, napi_value value) {
  char text[8] = {0};
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, text, sizeof(text), &length) != napi_ok) return nil;
  if (length != 7 || text[0] != '#') return nil;
  unsigned int rgb = 0;
  if (sscanf(text + 1, "%6x", &rgb) != 1) return nil;
  return [NSColor colorWithSRGBRed:((rgb >> 16) & 0xff) / 255.0
                             green:((rgb >> 8) & 0xff) / 255.0
                              blue:(rgb & 0xff) / 255.0
                             alpha:1];
}

/** Shows or hides what macOS shows with the menu bar in full screen: its own window buttons. */
static void hideMenuBarButtons(BOOL hidden) {
  Class toolbarWindow = NSClassFromString(@"NSToolbarFullScreenWindow");
  SEL setContentHidden = NSSelectorFromString(@"setContentHidden:");
  for (NSWindow *window in NSApp.windows) {
    if (toolbarWindow && [window isKindOfClass:toolbarWindow] &&
        [window respondsToSelector:setContentHidden]) {
      ((void (*)(id, SEL, BOOL))[window methodForSelector:setContentHidden])(window,
                                                                            setContentHidden,
                                                                            hidden);
    }
  }
}

static napi_value boolean(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

static size_t arguments(napi_env env, napi_callback_info info, napi_value *args, size_t count) {
  size_t given = count;
  napi_get_cb_info(env, info, &given, args, NULL, NULL);
  return given;
}

/** show(handle, colour): puts the buttons in the window, in the grey given. */
static napi_value Show(napi_env env, napi_callback_info info) {
  napi_value args[2];
  if (arguments(env, info, args, 2) < 2) return boolean(env, false);
  NSWindow *window = windowOf(env, args[0]);
  if (!window || buttonsIn(window)) return boolean(env, false);
  NSView *frame = frameViewOf(window);
  NSButton *original = [window standardWindowButton:NSWindowCloseButton];
  NSRect close = original.frame;
  NSRect miniaturize = [window standardWindowButton:NSWindowMiniaturizeButton].frame;
  NSRect zoom = [window standardWindowButton:NSWindowZoomButton].frame;
  // macOS's sizes, or the usual ones (a claim, not measured) should the window have none.
  if (NSIsEmptyRect(close) || NSIsEmptyRect(zoom)) {
    close = NSMakeRect(0, 0, 14, 16);
    miniaturize = NSMakeRect(20, 0, 14, 16);
    zoom = NSMakeRect(40, 0, 14, 16);
  }
  CGFloat height = NSHeight(close);
  CGFloat step = NSMinX(miniaturize) - NSMinX(close);
  CGFloat zoomStep = NSMinX(zoom) - NSMinX(close);

  // Either way up: y from the top if it's flipped, else from the bottom.
  BOOL flipped = frame.isFlipped;
  CGFloat y = flipped ? TOP : NSHeight(frame.bounds) - TOP - height;
  CerebroFullScreenButtons *view = [[CerebroFullScreenButtons alloc]
      initWithFrame:NSMakeRect(LEFT, y, zoomStep + NSWidth(zoom), height)];
  view.autoresizingMask = flipped ? NSViewMaxYMargin : NSViewMinYMargin;
  view.colour = colourOf(env, args[1]);
  NSUInteger mask = window.styleMask;
  NSButton *buttons[3] = {
      [NSWindow standardWindowButton:NSWindowCloseButton forStyleMask:mask],
      [NSWindow standardWindowButton:NSWindowMiniaturizeButton forStyleMask:mask],
      [NSWindow standardWindowButton:NSWindowZoomButton forStyleMask:mask],
  };
  // The buttons in a row inside the view, not in it: Electron hides "the window's close button's
  // superview's superview" as leaving full screen starts, taking it for the title bar's container
  // (window_buttons_proxy.mm), and AppKit gives ours as the window's close button while they're in
  // it. In a row, that's this view, which then hides as JetBrains Runtime hides its buttons;
  // without one, it was the window's frame view, left hidden: a transparent window.
  NSView *row = [[NSView alloc] initWithFrame:view.bounds];
  row.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [view addSubview:row];
  CGFloat offsets[3] = {0, step, zoomStep};
  for (int i = 0; i < 3; i++) {
    [buttons[i] setFrame:NSMakeRect(offsets[i], 0, NSWidth(close), height)];
    [row addSubview:buttons[i]];
  }
  [view addTrackingArea:[[NSTrackingArea alloc]
                            initWithRect:NSZeroRect
                                 options:NSTrackingActiveAlways | NSTrackingMouseEnteredAndExited |
                                         NSTrackingInVisibleRect
                                   owner:view
                                userInfo:nil]];
  [view show:NO];
  [frame addSubview:view positioned:NSWindowAbove relativeTo:nil];
  hideMenuBarButtons(YES);
  __weak CerebroFullScreenButtons *weak = view;
  view.leaving = [NSNotificationCenter.defaultCenter
      addObserverForName:NSWindowWillExitFullScreenNotification
                  object:window
                   queue:nil
              usingBlock:^(NSNotification *notification) {
                weak.hidden = YES;
                hideMenuBarButtons(NO);
              }];
  return boolean(env, true);
}

/** hide(handle): takes the buttons out of the window, and gives macOS's back. */
static napi_value Hide(napi_env env, napi_callback_info info) {
  napi_value args[1];
  if (arguments(env, info, args, 1) < 1) return boolean(env, false);
  NSWindow *window = windowOf(env, args[0]);
  CerebroFullScreenButtons *view = window ? buttonsIn(window) : nil;
  hideMenuBarButtons(NO);
  if (!view) return boolean(env, false);
  if (view.leaving) [NSNotificationCenter.defaultCenter removeObserver:view.leaving];
  [view removeFromSuperview];
  return boolean(env, true);
}

/** colour(handle, colour): greys the buttons as the theme. */
static napi_value Colour(napi_env env, napi_callback_info info) {
  napi_value args[2];
  if (arguments(env, info, args, 2) < 2) return boolean(env, false);
  NSWindow *window = windowOf(env, args[0]);
  CerebroFullScreenButtons *view = window ? buttonsIn(window) : nil;
  if (!view) return boolean(env, false);
  view.colour = colourOf(env, args[1]);
  [view setNeedsDisplay:YES];
  return boolean(env, true);
}

static napi_value number(napi_env env, double value) {
  napi_value result;
  napi_create_double(env, value, &result);
  return result;
}

/** A frame as { x, y, width, height }, y from the window's top. */
static napi_value frameOf(napi_env env, NSView *view) {
  NSRect frame = [view convertRect:view.bounds toView:nil];
  CGFloat top = NSHeight(view.window.frame) - NSMaxY(frame);
  napi_value result;
  napi_create_object(env, &result);
  napi_set_named_property(env, result, "x", number(env, NSMinX(frame)));
  napi_set_named_property(env, result, "y", number(env, top));
  napi_set_named_property(env, result, "width", number(env, NSWidth(frame)));
  napi_set_named_property(env, result, "height", number(env, NSHeight(frame)));
  return result;
}

/** Whether a click at the middle of the buttons reaches them, as AppKit finds a click's view. */
static bool reached(CerebroFullScreenButtons *view) {
  NSRect bounds = [view convertRect:view.bounds toView:nil];
  NSPoint middle = NSMakePoint(NSMidX(bounds), NSMidY(bounds));
  NSView *hit = [frameViewOf(view.window) hitTest:middle];
  return hit != nil && [hit isDescendantOf:view];
}

/**
 * state(handle): the buttons' frames and classes, and whether a click reaches them; or null. For
 * the end-to-end tests.
 */
static napi_value State(napi_env env, napi_callback_info info) {
  napi_value args[1];
  napi_value result;
  napi_get_null(env, &result);
  if (arguments(env, info, args, 1) < 1) return result;
  NSWindow *window = windowOf(env, args[0]);
  CerebroFullScreenButtons *view = window ? buttonsIn(window) : nil;
  if (!view) return result;
  napi_value buttons;
  napi_create_array(env, &buttons);
  napi_create_object(env, &result);
  napi_set_named_property(env, result, "buttons", buttons);
  napi_set_named_property(env, result, "reached", boolean(env, reached(view)));
  // Whether AppKit gives ours as the window's own close button.
  NSView *own = [window standardWindowButton:NSWindowCloseButton];
  napi_set_named_property(env, result, "theWindows",
                          boolean(env, own != nil && own == view.row.subviews.firstObject));
  uint32_t i = 0;
  for (NSView *button in view.row.subviews) {
    napi_value entry = frameOf(env, button);
    napi_value kind;
    const char *name = NSStringFromClass([button class]).UTF8String;
    napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &kind);
    napi_set_named_property(env, entry, "class", kind);
    napi_set_named_property(env, entry, "hidden", boolean(env, button.hidden));
    napi_set_element(env, buttons, i++, entry);
  }
  return result;
}

/** press(handle, index): clicks a button, as the pointer over it would; for the end-to-end tests. */
static napi_value Press(napi_env env, napi_callback_info info) {
  napi_value args[2];
  if (arguments(env, info, args, 2) < 2) return boolean(env, false);
  NSWindow *window = windowOf(env, args[0]);
  CerebroFullScreenButtons *view = window ? buttonsIn(window) : nil;
  uint32_t index = 0;
  if (!view || napi_get_value_uint32(env, args[1], &index) != napi_ok) return boolean(env, false);
  if (index >= view.row.subviews.count) return boolean(env, false);
  [view show:YES];
  [(NSButton *)view.row.subviews[index] performClick:nil];
  return boolean(env, true);
}

/**
 * window(handle): whether the window and its content show, for the end-to-end tests: its content
 * and frame views hidden or not, its alpha, and whether it's visible.
 */
static napi_value WindowState(napi_env env, napi_callback_info info) {
  napi_value args[1];
  napi_value result;
  napi_get_null(env, &result);
  if (arguments(env, info, args, 1) < 1) return result;
  NSWindow *window = windowOf(env, args[0]);
  if (!window) return result;
  napi_create_object(env, &result);
  napi_set_named_property(env, result, "visible", boolean(env, window.visible));
  napi_set_named_property(env, result, "alpha", number(env, window.alphaValue));
  napi_set_named_property(env, result, "contentHidden", boolean(env, window.contentView.hidden));
  napi_set_named_property(env, result, "frameHidden", boolean(env, frameViewOf(window).hidden));
  return result;
}

NAPI_MODULE_INIT() {
  napi_property_descriptor properties[] = {
      {"show", NULL, Show, NULL, NULL, NULL, napi_default, NULL},
      {"hide", NULL, Hide, NULL, NULL, NULL, napi_default, NULL},
      {"colour", NULL, Colour, NULL, NULL, NULL, napi_default, NULL},
      {"state", NULL, State, NULL, NULL, NULL, napi_default, NULL},
      {"press", NULL, Press, NULL, NULL, NULL, napi_default, NULL},
      {"window", NULL, WindowState, NULL, NULL, NULL, napi_default, NULL},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}
