/**
 * Vitest config for the pure layers: core, render and the export filename helper.
 *
 * Run directly rather than through `@angular/build:unit-test`, for the same reason the Expo
 * project ran them outside jest-expo: nothing in `src/app/core`, `src/app/render/html.ts` or
 * `src/app/export/filename.ts` may import Angular, Ionic or Capacitor. Running them in a plain
 * Node environment with no Angular test harness present makes that a build-enforced rule
 * rather than a convention — if someone adds an Angular import to the money code, this suite
 * stops compiling.
 *
 * Angular component tests, when they exist, belong under `ng test` instead.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/app/core/**/*.spec.ts',
      'src/app/render/**/*.spec.ts',
      'src/app/export/filename.spec.ts',
      'src/app/data/schema.spec.ts',
    ],
    reporters: ['default'],
  },
});
