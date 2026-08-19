import path from 'node:path';
import { defineConfig } from 'vite';

/**
 * Config for `vite-node scripts/screenshots/buildFixture.ts`. `@` matches the app's
 * own alias so the data layer imports resolve; AsyncStorage is aliased to an
 * in-memory shim so those same modules run under plain Node, with their writes
 * landing somewhere we can read back.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@react-native-async-storage/async-storage': path.resolve(__dirname, 'asyncStorageShim.ts'),
      '@': path.resolve(__dirname, '../../src'),
    },
  },
});
