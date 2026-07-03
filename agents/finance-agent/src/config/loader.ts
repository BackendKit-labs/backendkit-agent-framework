import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'yaml';
import { CompanyConfigSchema, type CompanyConfig } from './schema';

// ──────────────────────────────────────────────
// Errores personalizados
// ──────────────────────────────────────────────

/**
 * Error lanzado cuando hay un problema con la configuración.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Error lanzado cuando falta una variable de entorno requerida.
 */
export class MissingSecretError extends ConfigError {
  public readonly secretName: string;

  constructor(secretName: string) {
    super(`Variable de entorno requerida '${secretName}' no está definida`);
    this.name = 'MissingSecretError';
    this.secretName = secretName;
  }
}

// ──────────────────────────────────────────────
// Funciones auxiliares
// ──────────────────────────────────────────────

/**
 * Resuelve las variables {{VAR}} en un string usando process.env.
 * Si una variable no está definida y es requerida, lanza MissingSecretError.
 * 
 * @param value - String que puede contener {{VAR}} placeholders
 * @param required - Si es true, lanza error si la variable no existe
 * @returns String con las variables resueltas
 */
function resolvePlaceholders(value: string, required: boolean = true): string {
  return value.replace(/\{\{(\w+)\}\}/g, (match, varName: string) => {
    const envValue = process.env[varName];
    if (envValue === undefined) {
      if (required) {
        throw new MissingSecretError(varName);
      }
      return match; // Mantener el placeholder si no es requerido
    }
    return envValue;
  });
}

/**
 * Recorre recursivamente un objeto resolviendo placeholders {{VAR}} en strings.
 * 
 * @param obj - Objeto a procesar
 * @param required - Si es true, lanza error si una variable no existe
 * @returns Objeto con placeholders resueltos
 */
function resolveDeep(obj: unknown, required: boolean = true): unknown {
  if (typeof obj === 'string') {
    return resolvePlaceholders(obj, required);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => resolveDeep(item, required));
  }
  
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = resolveDeep(value, required);
    }
    return result;
  }
  
  return obj;
}

// ──────────────────────────────────────────────
// Funciones principales
// ──────────────────────────────────────────────

/**
 * Carga y valida la configuración desde un archivo YAML.
 * 
 * Funcionalidades:
 * - Lee el archivo YAML desde la ruta especificada
 * - Resuelve placeholders {{VAR}} usando process.env
 * - Valida contra el schema Zod CompanyConfigSchema
 * - Lanza ConfigError si el archivo no existe o no es válido
 * - Lanza MissingSecretError si falta una variable de entorno requerida
 * 
 * @param configPath - Ruta al archivo config.yaml (absoluta o relativa)
 * @returns Configuración tipada y validada
 * @throws ConfigError si el archivo no existe o no se puede leer
 * @throws MissingSecretError si falta una variable de entorno requerida
 * @throws z.ZodError si la configuración no pasa la validación del schema
 */
export function loadConfig(configPath: string): CompanyConfig {
  // Resolver ruta absoluta
  const absolutePath = resolve(configPath);
  
  // Verificar que el archivo existe
  if (!existsSync(absolutePath)) {
    throw new ConfigError(`Archivo de configuración no encontrado: ${absolutePath}`);
  }
  
  // Leer archivo YAML
  let rawContent: string;
  try {
    rawContent = readFileSync(absolutePath, 'utf-8');
  } catch (error) {
    throw new ConfigError(
      `Error al leer el archivo de configuración: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  
  // Parsear YAML
  let parsed: unknown;
  try {
    parsed = parse(rawContent);
  } catch (error) {
    throw new ConfigError(
      `Error al parsear YAML: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  
  // Validar que sea un objeto
  if (typeof parsed !== 'object' || parsed === null) {
    throw new ConfigError('El archivo de configuración debe contener un objeto YAML válido');
  }
  
  // Resolver placeholders en todo el objeto (primera pasada, no requerida)
  const resolved = resolveDeep(parsed, false) as Record<string, unknown>;
  
  // Validar contra el schema
  const validationResult = CompanyConfigSchema.safeParse(resolved);
  
  if (!validationResult.success) {
    // Extraer errores de validación
    const errors = validationResult.error.errors.map(
      err => `${err.path.join('.')}: ${err.message}`
    );
    throw new ConfigError(
      `Error de validación de configuración:\n${errors.join('\n')}`
    );
  }
  
  // Segunda pasada: resolver placeholders requeridos en strings que puedan haber quedado
  // (por ejemplo, en campos que no son strings directos pero contienen placeholders)
  const config = validationResult.data;
  
  // Verificar que no queden placeholders sin resolver en campos críticos
  checkResolvedSecrets(config);
  
  return config;
}

/**
 * Verifica recursivamente que no queden placeholders {{VAR}} sin resolver
 * en la configuración. Lanza MissingSecretError si encuentra alguno.
 */
function checkResolvedSecrets(obj: unknown, path: string = ''): void {
  if (typeof obj === 'string') {
    const unresolved = obj.match(/\{\{(\w+)\}\}/g);
    if (unresolved) {
      for (const match of unresolved) {
        const varName = match.slice(2, -2); // Extraer nombre de {{VAR}}
        throw new MissingSecretError(varName);
      }
    }
    return;
  }
  
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => checkResolvedSecrets(item, `${path}[${index}]`));
    return;
  }
  
  if (obj !== null && typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      checkResolvedSecrets(value, path ? `${path}.${key}` : key);
    }
  }
}

/**
 * Devuelve la ruta del vault de la empresa.
 *
 * La ruta se construye como: {basePath}/{companyId}
 * donde basePath se obtiene de la variable de entorno VAULT_PATH
 * o por defecto './vaults'.
 *
 * @param companyId - ID de la empresa
 * @returns Ruta al vault de la empresa
 * @throws ConfigError si companyId está vacío o no fue provisto
 */
export function resolveVaultPath(companyId: string): string {
  if (!companyId) {
    throw new ConfigError('companyId no puede estar vacío');
  }
  const basePath = process.env.VAULT_PATH || './vaults';
  return resolve(basePath, companyId);
}

/**
 * Resuelve todos los placeholders {{VAR}} en un objeto de configuración
 * usando variables de entorno (process.env).
 * 
 * Esta función es útil para resolver secrets en objetos específicos
 * (como credenciales de MCP servers) después de la carga inicial.
 * 
 * @param obj - Objeto con posibles placeholders {{VAR}}
 * @returns Objeto con placeholders resueltos
 * @throws MissingSecretError si falta una variable de entorno requerida
 */
export function resolveSecrets<T extends Record<string, unknown>>(obj: T, required: boolean = true): T {
  return resolveDeep(obj, required) as T;
}

// ──────────────────────────────────────────────
// Re-exportaciones útiles
// ──────────────────────────────────────────────

export type { CompanyConfig } from './schema';