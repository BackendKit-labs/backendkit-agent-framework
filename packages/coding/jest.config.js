/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/__tests__/**/*.test.ts'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
    },
    moduleNameMapper: {
        '^@bk/agent-core$': '<rootDir>/../core/src/index.ts',
    },
    coverageDirectory: 'coverage',
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/__tests__/**',
        '!src/**/index.ts',
        '!src/**/prompts/**',
    ],
    // Baseline medida el 2026-10-21: coding ~21 %, core ~34 %. El 60 % anterior nunca se aplicaba
    // (el CI no corria con --coverage); el umbral actual evita regresiones y se sube al ampliar tests.
    coverageThreshold: { global: { lines: 15 } },
};
