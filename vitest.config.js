const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/js/**/*.test.js'],
    exclude: ['tests/manual/**', 'src/dist/**', 'dist/**', 'python/**'],
    clearMocks: true,
    restoreMocks: true,
  },
});