/** @type {import('jest').Config} */
module.exports = {
    collectCoverageFrom: ['src/**/*.ts', '!src/**/__tests__/**', '!src/**/*.d.ts',
        // Worker-thread embedder: uses import.meta (ESM-only), not compilable under ts-jest CJS.
        '!src/knowledge/transformers-embedder.ts', '!src/knowledge/embedder-worker.ts', '!src/pdf-reader.ts'],
    coverageThreshold: { global: { lines: 80 } },
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/__tests__/**/*.test.ts'],
    resolver: '<rootDir>/jest.resolver.cjs',
    transform: {
        '^.+\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
    },
};
