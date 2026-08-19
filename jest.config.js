/**
 * Test projects.
 *
 * `core` and `pure` run under ts-jest in a plain Node environment, deliberately without
 * jest-expo. That is the mechanism enforcing spec §16.3 and §10.1's purity: if anything in
 * `src/core`, `src/render/html.ts` or `src/export/filename.ts` acquires a React,
 * react-native or expo-sqlite import, these suites fail to compile. The rule is checked by
 * the build rather than by review.
 *
 * `db` executes the real schema and migrations against Node's built-in `node:sqlite`, so a
 * SQL error is caught here instead of on a device.
 */
module.exports = {
  projects: [
    {
      displayName: 'core',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/core/**/__tests__/**/*.test.ts'],
      transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.core.json' }],
      },
    },
    {
      displayName: 'db',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/db/__tests__/**/*.test.ts'],
      transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.db.json' }],
      },
    },
    {
      displayName: 'pure',
      testEnvironment: 'node',
      testMatch: [
        '<rootDir>/src/render/__tests__/**/*.test.ts',
        '<rootDir>/src/export/__tests__/**/*.test.ts',
      ],
      transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.unit.json' }],
      },
    },
  ],
  collectCoverageFrom: ['src/core/**/*.ts', 'src/render/html.ts', '!**/__tests__/**'],
};
