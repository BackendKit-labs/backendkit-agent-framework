/** @type {import('jest').Config} */
module.exports = {
    collectCoverageFrom: ['src/**/*.ts', '!src/**/__tests__/**', '!src/**/*.d.ts'],
    coverageThreshold: { global: { lines: 30 } },
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/__tests__/**/*.test.ts'],
    transform: {
        '^.+\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
    },
};
