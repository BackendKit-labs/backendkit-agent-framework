import type { CustomDomainDefinition } from '@backendkit-labs/agent-core';

type DomainInput = Omit<CustomDomainDefinition, 'createdAt'>;

// ── Severity → promotion threshold ───────────────────────────────────────────
// The core ReflectionEngine uses a fixed threshold of 3.
// Enterprise overrides per-severity so a critical failure triggers immediately.

export const SEVERITY_THRESHOLD: Record<string, number> = {
    critical: 1,
    high:     2,
    medium:   3,
    low:      3,
};

// ── Enterprise domains ────────────────────────────────────────────────────────
// Each failureType mirrors a PolicySeeder policy, closing the loop:
//   policy violated → incident → pattern → deterministic rule
//
// Domains must be registered once per project via DomainRegistry.registerDomain()
// before any incident can be filed against them.

export const ENTERPRISE_DOMAINS: DomainInput[] = [
    {
        name: 'legal',
        description: 'Contratos, cláusulas, compliance normativo y política salarial',
        failureTypes: [
            {
                name:           'non_compliant_clause',
                severity:       'critical',
                dimension:      'compliance',
                keywords:       ['normativa', 'ilegal', 'incumple', 'irregular', 'no cumple'],
                recommendation: 'Revisión legal obligatoria antes de emitir o firmar el contrato',
            },
            {
                name:           'missing_confidentiality',
                severity:       'high',
                dimension:      'compliance',
                keywords:       ['confidencialidad', 'nda', 'cláusula faltante', 'sin cláusula'],
                recommendation: 'Incluir cláusula de confidencialidad antes de continuar',
            },
            {
                name:           'salary_out_of_policy',
                severity:       'high',
                dimension:      'finanzas',
                keywords:       ['salario', 'remuneración', 'fuera de banda', 'fuera de política'],
                recommendation: 'Ajustar remuneración a la banda salarial aprobada',
            },
            {
                name:           'risky_clause',
                severity:       'high',
                dimension:      'compliance',
                keywords:       ['riesgosa', 'cláusula peligrosa', 'no estándar', 'atípica'],
                recommendation: 'Escalar a asesor legal externo para revisión',
            },
        ],
    },
    {
        name: 'finanzas',
        description: 'Aprobaciones de gasto, autoridad financiera, confidencialidad de datos',
        failureTypes: [
            {
                name:           'over_approval_threshold',
                severity:       'critical',
                dimension:      'autoridad',
                keywords:       ['excede límite', 'supera autoridad', 'sin aprobación', 'threshold'],
                recommendation: 'Escalar al nivel de aprobación correspondiente (ver approval-authority.md)',
            },
            {
                name:           'confidential_data_leak',
                severity:       'critical',
                dimension:      'confidencialidad',
                keywords:       ['margen', 'ganancia', 'revenue', 'salario', 'bonus', 'forecast'],
                recommendation: 'No compartir datos financieros sensibles fuera de canales oficiales',
            },
            {
                name:           'split_transaction',
                severity:       'high',
                dimension:      'autoridad',
                keywords:       ['fragmentado', 'split', 'dividido', 'evitar umbral'],
                recommendation: 'Consolidar transacciones y procesar con la autoridad correcta',
            },
        ],
    },
    {
        name: 'rrhh',
        description: 'Datos personales de empleados, onboarding, privacidad, RRHH',
        failureTypes: [
            {
                name:           'pii_exposure',
                severity:       'critical',
                dimension:      'privacidad',
                keywords:       ['dni', 'legajo', 'domicilio', 'teléfono personal', 'médico', 'discapacidad'],
                recommendation: 'No compartir datos personales sin verificar autorización del receptor',
            },
            {
                name:           'salary_disclosure',
                severity:       'critical',
                dimension:      'privacidad',
                keywords:       ['salario', 'remuneración', 'compensación', 'bonus'],
                recommendation: 'Datos salariales solo al empleado, su manager o HR Director',
            },
            {
                name:           'incomplete_checklist',
                severity:       'medium',
                dimension:      'proceso',
                keywords:       ['incompleto', 'falta documento', 'pendiente', 'sin firma'],
                recommendation: 'Completar el checklist antes de continuar el onboarding',
            },
            {
                name:           'unauthorized_data_request',
                severity:       'high',
                dimension:      'privacidad',
                keywords:       ['sin autorización', 'solicitud no verificada', 'agrega datos'],
                recommendation: 'Verificar autorización del solicitante antes de proveer información',
            },
        ],
    },
    {
        name: 'ventas',
        description: 'Descuentos, precios, autoridad comercial',
        failureTypes: [
            {
                name:           'over_discount_authority',
                severity:       'high',
                dimension:      'autoridad',
                keywords:       ['descuento excede', 'sin aprobación', 'descuento no autorizado'],
                recommendation: 'Obtener aprobación del nivel correspondiente (ver discount-authority.md)',
            },
            {
                name:           'retroactive_discount',
                severity:       'high',
                dimension:      'proceso',
                keywords:       ['retroactivo', 'post-factura', 'ya facturado'],
                recommendation: 'Escalar a Finance además de Sales para aprobación retroactiva',
            },
        ],
    },
    {
        name: 'operaciones',
        description: 'Incidentes, severidad, SLAs operacionales',
        failureTypes: [
            {
                name:           'wrong_severity_classification',
                severity:       'high',
                dimension:      'proceso',
                keywords:       ['severidad incorrecta', 'subclasificado', 'downgrade silencioso'],
                recommendation: 'Reclasificar al nivel correcto y notificar escalation path',
            },
            {
                name:           'missed_escalation',
                severity:       'high',
                dimension:      'proceso',
                keywords:       ['sin escalar', 'no notificó', 'no escaló', 'omitió escalamiento'],
                recommendation: 'Activar escalation path inmediatamente y documentar demora',
            },
        ],
    },
    {
        name: 'soporte',
        description: 'Escalamiento de tickets, tier de soporte, atención al cliente',
        failureTypes: [
            {
                name:           'wrong_tier_handling',
                severity:       'medium',
                dimension:      'proceso',
                keywords:       ['tier incorrecto', 'debería escalar', 'resolvió sin escalar'],
                recommendation: 'Seguir matriz de escalamiento (ver escalation-levels.md)',
            },
            {
                name:           'delayed_tier3_escalation',
                severity:       'critical',
                dimension:      'proceso',
                keywords:       ['outage', 'pérdida de datos', 'seguridad', 'no escaló p1'],
                recommendation: 'Escalar Tier 3 dentro de 5 minutos de identificado',
            },
        ],
    },
];
