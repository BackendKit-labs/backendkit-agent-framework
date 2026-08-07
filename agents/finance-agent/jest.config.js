/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  // Use ts-jest preset for TypeScript support
  preset: 'ts-jest',

  // Node.js environment for backend testing
  testEnvironment: 'node',

  // Root directory for tests
  roots: ['<rootDir>/tests'],

  // Test file patterns
  testMatch: [
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/?(*.)+(spec|test).+(ts|tsx|js)',
  ],

  // TypeScript transformation
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },

  // Module path aliases (matching tsconfig paths)
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^@tools/(.*)$': '<rootDir>/src/tools/$1',
    '^@entry-points/(.*)$': '<rootDir>/src/entry-points/$1',
    '^@backendkit-labs/agent-core$': '<rootDir>/tests/__mocks__/agent-core.ts',
  },

  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov', 'clover'],

  // Verbose output for detailed test results
  verbose: true,

  // Clear mocks between tests automatically
  clearMocks: true,

  // Restore mocks after each test
  restoreMocks: true,

  // Timeout for async tests (30 seconds)
  testTimeout: 30000,

  // Detect open handles (e.g., unclosed connections)
  detectOpenHandles: true,

  // Force exit after test completion
  forceExit: true,

  // Global setup/teardown if needed
  // globalSetup: '<rootDir>/tests/setup.ts',
  // globalTeardown: '<rootDir>/tests/teardown.ts',

  // Paths to ignore
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/',
  ],

  // TypeScript configuration for ts-jest
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.json',
      diagnostics: true,
      isolatedModules: true,
    },
  },
};
