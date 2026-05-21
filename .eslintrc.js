module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      // The renderer calls @shopify/react-native-skia paint factories
      // (useFillPaint, useTextPaint, useStrokePaint) from imperative draw
      // helpers (drawTextNode, drawEdge, ...). These functions follow the
      // "useXxx" naming convention but are not React Hooks — they're paint
      // builders. The Hooks rule can't tell the difference and false-positives
      // on every call site. Scope the disable narrowly to renderer code; the
      // core/ tree is unaffected.
      files: ['src/renderer/**/*.{ts,tsx}'],
      rules: {
        'react-hooks/rules-of-hooks': 'off',
      },
    },
  ],
};
