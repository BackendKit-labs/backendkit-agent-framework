/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/__tests__/**/*.test.ts'],
    resolver: '<rootDir>/jest.resolver.cjs',
    transform: {
        '^.+\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
    },
};
