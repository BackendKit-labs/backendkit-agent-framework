import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { loadConfig, resolveVaultPath, resolveSecrets, ConfigError, MissingSecretError } from '../../src/config/loader';
import { CompanyConfig } from '../../src/config/schema';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ──────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────

jest.mock('fs');
jest.mock('path');

const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockResolve = resolve as jest.MockedFunction<typeof resolve>;

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

const VALID_YAML = `
company:
  id: "emp-001"
  name: "Test Corp"
  country: "CO"
  currency: "COP"
  fiscal_year_start: "01-01"

providers:
  default:
    model: "deepseek-chat"
    temperature: 0.3

tools:
  enabled:
    - "income_statement"
    - "balance_sheet"
    - "cash_flow"

gates:
  email_report:
    enabled: true
    requires_approval: false
  export_data:
    enabled: true
    requires_approval: true

mcp_servers:
  - name: "erp"
    transport: "stdio"
    command: "node"
    args: ["erp-server.js"]

scheduler:
  default_tasks:
    - id: "monthly-close"
      cron: "0 0 1 * *"
      workflow: "generate-report"
      workflowInput:
        reportType: "monthly-close"
      notifyOnFailure: true
      notifyTo: ["cfo@testcorp.com"]

notifications:
  default_channel: "email"
  weekly_report:
    recipients: ["cfo@testcorp.com"]
    channel: "email"
  alerts:
    recipients: ["cfo@testcorp.com"]
    channel: "slack"
    priority: "high"
`;

const VALID_YAML_WITH_ENV = `
company:
  id: "emp-001"
  name: "Test Corp"
  country: "CO"
  currency: "COP"
  fiscal_year_start: "01-01"

providers:
  default:
    model: "deepseek-chat"
    temperature: 0.3

tools:
  enabled:
    - "income_statement"
    - "balance_sheet"
    - "cash_flow"

gates:
  email_report:
    enabled: true
    requires_approval: false
  export_data:
    enabled: true
    requires_approval: true

mcp_servers:
  - name: "erp"
    transport: "stdio"
    command: "node"
    args: ["erp-server.js"]

scheduler:
  default_tasks:
    - id: "monthly-close"
      cron: "0 0 1 * *"
      workflow: "generate-report"
      workflowInput:
        reportType: "monthly-close"
      notifyOnFailure: true
      notifyTo: ["{{NOTIFY_EMAIL}}" ]

notifications:
  default_channel: "email"
  weekly_report:
    recipients: ["{{NOTIFY_EMAIL}}" ]
    channel: "email"
  alerts:
    recipients: ["{{NOTIFY_EMAIL}}" ]
    channel: "slack"
    priority: "high"
`;

const VALID_YAML_WITH_MISSING_SECRET = `
company:
  id: "emp-001"
  name: "Test Corp"
  country: "CO"
  currency: "COP"
  fiscal_year_start: "01-01"

providers:
  default:
    model: "deepseek-chat"
    temperature: 0.3

tools:
  enabled:
    - "income_statement"
    - "balance_sheet"
    - "cash_flow"

gates:
  email_report:
    enabled: true
    requires_approval: false
  export_data:
    enabled: true
    requires_approval: true

mcp_servers:
  - name: "erp"
    transport: "stdio"
    command: "node"
    args: ["erp-server.js"]

scheduler:
  default_tasks:
    - id: "monthly-close"
      cron: "0 0 1 * *"
      workflow: "generate-report"
      workflowInput:
        reportType: "monthly-close"
      notifyOnFailure: true
      notifyTo: ["{{MISSING_VAR}}" ]

notifications:
  default_channel: "email"
  weekly_report:
    recipients: ["{{MISSING_VAR}}" ]
    channel: "email"
  alerts:
    recipients: ["{{MISSING_VAR}}" ]
    channel: "slack"
    priority: "high"
`;

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('loadConfig', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockResolve.mockImplementation((...args: string[]) => args.join('/'));
  });

  afterEach(() => {
    delete process.env.NOTIFY_EMAIL;
    delete process.env.MISSING_VAR;
  });

  it('debe cargar y validar una configuración YAML válida', () => {
    // Arrange
    const configPath = '/path/to/config.yaml';
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(VALID_YAML);

    // Act
    const config = loadConfig(configPath);

    // Assert
    expect(config).toBeDefined();
    expect(config.company.id).toBe('emp-001');
    expect(config.company.name).toBe('Test Corp');
    expect(config.company.country).toBe('CO');
    expect(config.company.currency).toBe('COP');
    expect(config.company.fiscal_year_start).toBe('01-01');
    expect(config.providers.default.model).toBe('deepseek-chat');
    expect(config.providers.default.temperature).toBe(0.3);
    expect(config.tools.enabled).toEqual(['income_statement', 'balance_sheet', 'cash_flow']);
    expect(config.gates.email_report.enabled).toBe(true);
    expect(config.gates.email_report.requires_approval).toBe(false);
    expect(config.gates.export_data.enabled).toBe(true);
    expect(config.gates.export_data.requires_approval).toBe(true);
    expect(config.mcp_servers).toHaveLength(1);
    expect(config.mcp_servers[0].name).toBe('erp');
    expect(config.scheduler.default_tasks).toHaveLength(1);
    expect(config.scheduler.default_tasks[0].id).toBe('monthly-close');
    expect(config.notifications.default_channel).toBe('email');
  });

  it('debe lanzar ConfigError si el archivo no existe', () => {
    // Arrange
    const configPath = '/path/to/nonexistent.yaml';
    mockExistsSync.mockReturnValue(false);

    // Act & Assert
    expect(() => loadConfig(configPath)).toThrow(ConfigError);
    expect(() => loadConfig(configPath)).toThrow(`Archivo de configuración no encontrado: ${configPath}`);
  });

  it('debe lanzar ConfigError si el YAML es inválido', () => {
    // Arrange
    const configPath = '/path/to/config.yaml';
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('invalid: yaml: : :');

    // Act & Assert
    expect(() => loadConfig(configPath)).toThrow(ConfigError);
  });

  it('debe lanzar ConfigError si el YAML no cumple con el schema', () => {
    // Arrange
    const configPath = '/path/to/config.yaml';
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(`
company:
  id: "emp-001"
  name: "Test Corp"
  country: "COL"  # Debe ser de 2 caracteres
  currency: "COP"
  fiscal_year_start: "01-01"
providers:
  default:
    model: "deepseek-chat"
    temperature: 0.3
tools:
  enabled:
    - "income_statement"
gates:
  email_report:
    enabled: true
    requires_approval: false
  export_data:
    enabled: true
    requires_approval: true
mcp_servers: []
scheduler:
  default_tasks: []
notifications:
  default_channel: "email"
  weekly_report:
    recipients: []
    channel: "email"
  alerts:
    recipients: []
    channel: "slack"
    priority: "high"
`);

    // Act & Assert
    expect(() => loadConfig(configPath)).toThrow(ConfigError);
  });

  it('debe resolver variables de entorno {{VAR}} correctamente', () => {
    // Arrange
    const configPath = '/path/to/config.yaml';
    process.env.NOTIFY_EMAIL = 'admin@testcorp.com';
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(VALID_YAML_WITH_ENV);

    // Act
    const config = loadConfig(configPath);

    // Assert
    expect(config.scheduler.default_tasks[0].notifyTo).toEqual(['admin@testcorp.com']);
    expect(config.notifications.weekly_report.recipients).toEqual(['admin@testcorp.com']);
    expect(config.notifications.alerts.recipients).toEqual(['admin@testcorp.com']);
  });

  it('debe lanzar MissingSecretError si falta una variable de entorno requerida', () => {
    // Arrange
    const configPath = '/path/to/config.yaml';
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(VALID_YAML_WITH_MISSING_SECRET);

    // Act & Assert
    expect(() => loadConfig(configPath)).toThrow(MissingSecretError);
    expect(() => loadConfig(configPath)).toThrow(
      expect.objectContaining({
        secretName: 'MISSING_VAR',
      })
    );
  });

  it('debe lanzar MissingSecretError con el nombre de la variable faltante', () => {
    // Arrange
    const configPath = '/path/to/config.yaml';
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(VALID_YAML_WITH_MISSING_SECRET);

    // Act & Assert
    try {
      loadConfig(configPath);
      // Si no lanza error, fallar el test
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(MissingSecretError);
      expect((error as MissingSecretError).secretName).toBe('MISSING_VAR');
    }
  });

  it('debe usar la ruta resuelta correctamente', () => {
    // Arrange
    const configPath = '/path/to/config.yaml';
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(VALID_YAML);
    mockResolve.mockReturnValue('/resolved/path/config.yaml');

    // Act
    const config = loadConfig(configPath);

    // Assert
    expect(mockResolve).toHaveBeenCalledWith(configPath);
    expect(mockReadFileSync).toHaveBeenCalledWith('/resolved/path/config.yaml', 'utf-8');
  });
});

describe('resolveVaultPath', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockResolve.mockImplementation((...args: string[]) => args.join('/'));
  });

  afterEach(() => {
    delete process.env.VAULT_PATH;
    delete process.env.COMPANY_ID;
  });

  it('debe devolver el path del vault usando VAULT_PATH y companyId', () => {
    // Arrange
    process.env.VAULT_PATH = '/data/vaults';
    const companyId = 'emp-001';

    // Act
    const vaultPath = resolveVaultPath(companyId);

    // Assert
    expect(vaultPath).toBe('/data/vaults/emp-001');
  });

  it('debe devolver el path del vault usando VAULT_PATH y companyId con ruta por defecto', () => {
    // Arrange
    delete process.env.VAULT_PATH;
    const companyId = 'emp-001';

    // Act
    const vaultPath = resolveVaultPath(companyId);

    // Assert
    expect(vaultPath).toBe('./vaults/emp-001');
  });

  it('debe lanzar ConfigError si companyId está vacío', () => {
    // Arrange
    process.env.VAULT_PATH = '/data/vaults';

    // Act & Assert
    expect(() => resolveVaultPath('')).toThrow(ConfigError);
    expect(() => resolveVaultPath('')).toThrow('companyId no puede estar vacío');
  });

  it('debe lanzar ConfigError si companyId es undefined', () => {
    // Arrange
    process.env.VAULT_PATH = '/data/vaults';

    // Act & Assert
    expect(() => resolveVaultPath(undefined as unknown as string)).toThrow(ConfigError);
  });

  it('debe usar VAULT_PATH de variable de entorno si está definida', () => {
    // Arrange
    process.env.VAULT_PATH = '/custom/vaults';
    const companyId = 'emp-002';

    // Act
    const vaultPath = resolveVaultPath(companyId);

    // Assert
    expect(vaultPath).toBe('/custom/vaults/emp-002');
  });

  it('debe usar el path por defecto ./vaults si VAULT_PATH no está definido', () => {
    // Arrange
    delete process.env.VAULT_PATH;
    const companyId = 'emp-003';

    // Act
    const vaultPath = resolveVaultPath(companyId);

    // Assert
    expect(vaultPath).toBe('./vaults/emp-003');
  });
});

describe('resolveSecrets', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  afterEach(() => {
    delete process.env.API_KEY;
    delete process.env.DB_PASSWORD;
    delete process.env.MISSING_VAR;
  });

  it('debe reemplazar {{VAR}} con valores de process.env', () => {
    // Arrange
    process.env.API_KEY = 'sk-123456';
    process.env.DB_PASSWORD = 'secret123';
    const input = {
      apiKey: '{{API_KEY}}',
      dbPassword: '{{DB_PASSWORD}}',
      host: 'localhost',
    };

    // Act
    const result = resolveSecrets(input);

    // Assert
    expect(result).toEqual({
      apiKey: 'sk-123456',
      dbPassword: 'secret123',
      host: 'localhost',
    });
  });

  it('debe reemplazar {{VAR}} en arrays', () => {
    // Arrange
    process.env.API_KEY = 'sk-123456';
    const input = {
      endpoints: ['{{API_KEY}}', 'static-value'],
    };

    // Act
    const result = resolveSecrets(input);

    // Assert
    expect(result).toEqual({
      endpoints: ['sk-123456', 'static-value'],
    });
  });

  it('debe reemplazar {{VAR}} en objetos anidados', () => {
    // Arrange
    process.env.API_KEY = 'sk-123456';
    const input = {
      nested: {
        deep: {
          value: '{{API_KEY}}',
        },
      },
    };

    // Act
    const result = resolveSecrets(input);

    // Assert
    expect(result).toEqual({
      nested: {
        deep: {
          value: 'sk-123456',
        },
      },
    });
  });

  it('debe lanzar MissingSecretError si falta una variable de entorno', () => {
    // Arrange
    const input = {
      apiKey: '{{MISSING_VAR}}',
    };

    // Act & Assert
    expect(() => resolveSecrets(input)).toThrow(MissingSecretError);
    expect(() => resolveSecrets(input)).toThrow(
      expect.objectContaining({
        secretName: 'MISSING_VAR',
      })
    );
  });

  it('debe mantener los placeholders si required es false', () => {
    // Arrange
    const input = {
      apiKey: '{{MISSING_VAR}}',
    };

    // Act
    const result = resolveSecrets(input, false);

    // Assert
    expect(result).toEqual({
      apiKey: '{{MISSING_VAR}}',
    });
  });

  it('debe manejar valores que no son strings (números, booleanos, null)', () => {
    // Arrange
    const input = {
      port: 3000,
      enabled: true,
      config: null,
      items: [1, 2, 3],
    };

    // Act
    const result = resolveSecrets(input);

    // Assert
    expect(result).toEqual({
      port: 3000,
      enabled: true,
      config: null,
      items: [1, 2, 3],
    });
  });

  it('debe reemplazar múltiples {{VAR}} en el mismo string', () => {
    // Arrange
    process.env.HOST = 'db.example.com';
    process.env.PORT = '5432';
    const input = {
      connectionString: 'postgres://{{HOST}}:{{PORT}}/mydb',
    };

    // Act
    const result = resolveSecrets(input);

    // Assert
    expect(result).toEqual({
      connectionString: 'postgres://db.example.com:5432/mydb',
    });
  });

  it('debe lanzar MissingSecretError con el nombre de la primera variable faltante', () => {
    // Arrange
    const input = {
      key1: '{{VAR1}}',
      key2: '{{VAR2}}',
    };

    // Act & Assert
    try {
      resolveSecrets(input);
      // Si no lanza error, fallar el test
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(MissingSecretError);
      expect((error as MissingSecretError).secretName).toBe('VAR1');
    }
  });

  it('debe manejar objetos vacíos', () => {
    // Arrange
    const input = {};

    // Act
    const result = resolveSecrets(input);

    // Assert
    expect(result).toEqual({});
  });

  it('debe manejar arrays vacíos', () => {
    // Arrange
    const input = { items: [] };

    // Act
    const result = resolveSecrets(input);

    // Assert
    expect(result).toEqual({ items: [] });
  });
});