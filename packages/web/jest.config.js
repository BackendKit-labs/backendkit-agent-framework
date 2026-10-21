/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    collectCoverageFrom: ['src/**/*.ts', '!src/**/__tests__/**', '!src/**/*.d.ts'],
    coverageThreshold: { global: { lines: 88 } },
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/__tests__/**/*.test.ts'],
    transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
    },
    // Integration tests (AgentServer) start real HTTP/WS servers; forceExit
    // ensures Jest doesn't hang waiting for lingering async handles.
    forceExit: true,
};
