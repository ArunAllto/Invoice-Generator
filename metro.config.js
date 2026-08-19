const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The `docx` package and the `buffer` polyfill are CJS/Node-flavoured. Metro needs
// `buffer` resolvable as a bare specifier because docx references it internally.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  buffer: require.resolve('buffer/'),
};

// Font binaries are read as base64 at runtime and inlined into the export HTML.
//
// `wasm` is here for the web target only: `expo-sqlite`'s browser implementation imports
// wa-sqlite's `.wasm` binary, which Metro otherwise refuses to resolve. Listing it as an
// asset is harmless for Android, which never touches that code path.
config.resolver.assetExts = [
  ...new Set([...config.resolver.assetExts, 'ttf', 'otf', 'wasm']),
];

/**
 * Cross-origin isolation headers, for the web dev target only.
 *
 * `expo-sqlite`'s browser implementation runs wa-sqlite in a worker that needs
 * `SharedArrayBuffer` to reach OPFS synchronously. The browser only exposes that in a
 * cross-origin-isolated context, which requires these two response headers — without them
 * reads appear to work and the first *write* hangs for ever, which is a miserable thing to
 * debug.
 *
 * This affects the development server only. The Android app never goes through Metro at
 * runtime, and React Native ignores these headers, so nothing about the shipped build changes.
 */
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    return middleware(req, res, next);
  },
};

module.exports = config;
