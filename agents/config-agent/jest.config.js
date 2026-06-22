/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'node16',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          isolatedModules: true,
          resolveJsonModule: true,
        },
        useESM: true,
      },
    ],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  collectCoverageFrom: [
    'src/services/**/*.ts',
    'src/tools/setConfig.ts',
    'src/tools/setSecret.ts',
    'src/tools/importConfig.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.d.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    'src/services/': {
      lines: 70,
      functions: 70,
      branches: 70,
    },
    'src/tools/setConfig.ts': {
      lines: 80,
      functions: 80,
    },
    'src/tools/setSecret.ts': {
      lines: 80,
      functions: 80,
    },
    'src/tools/importConfig.ts': {
      lines: 80,
      functions: 80,
    },
  },
};
