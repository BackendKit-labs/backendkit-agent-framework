/** @type {import('jest').Config} */
module.exports = {
    collectCoverageFrom: ['src/**/*.ts', '!src/**/__tests__/**', '!src/**/*.d.ts'],
    // Baseline 22 % con isolatedModules (antes 45 %: ts-jest descartaba en silencio los archivos grandes sin tests).
    coverageThreshold: { global: { lines: 18 } },
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/__tests__/**/*.test.ts'],
    resolver: '<rootDir>/jest.resolver.cjs',
    transform: {
        '^.+\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json', isolatedModules: true }],
    },
};
