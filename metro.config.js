const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The `docx` package and the `buffer` polyfill are CJS/Node-flavoured. Metro needs
// `buffer` resolvable as a bare specifier because docx references it internally.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  buffer: require.resolve('buffer/'),
};

// Font binaries are read as base64 at runtime and inlined into the export HTML.
config.resolver.assetExts = [...new Set([...config.resolver.assetExts, 'ttf', 'otf'])];

module.exports = config;
