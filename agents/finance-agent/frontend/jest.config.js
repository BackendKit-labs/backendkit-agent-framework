/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  // Use ts-jest preset for TypeScript support
  preset: 'ts-jest',

  // jsdom environment for frontend testing (DOM APIs, fetch, etc.)
  testEnvironment: 'jsdom',

  // Root directory for tests
  roots: ['<rootDir>/src'],

  // Test file patterns
  testMatch: [
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/?(*.)+(spec|test).+(ts|tsx|js)',
  ],

  // TypeScript transformation — ts-jest config goes here (not in globals)
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.test.json',
      diagnostics: true,
      isolatedModules: true,
    }],
  },

  // Module path aliases (matching tsconfig paths)
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/app/**',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov', 'clover'],

  // Setup files — runs before each test suite
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],

  // Verbose output for detailed test results
  verbose: true,

  // Clear mocks between tests automatically
  clearMocks: true,

  // Restore mocks after each test
  restoreMocks: true,

  // Timeout for async tests (15 seconds)
  testTimeout: 15000,

  // Paths to ignore
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/.next/',
  ],
};
