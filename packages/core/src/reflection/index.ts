// Engine
export { ReflectionEngine } from './reflection-engine';
export type { ReflectionStats } from './reflection-engine';

// Catalog & detection
export { FailureCatalog } from './failure-catalog';
export { PatternDetector } from './pattern-detector';
export { PolicyPromoter } from './policy-promoter';

// Domain registry
export { DomainRegistry, BUILTIN_DOMAINS } from './domain-registry';
export type { BuiltinDomain, CustomDomainDefinition, FailureTypeDefinition } from './domain-registry';
export { DomainCommands } from './commands/domain-commands';
export type { AddDomainInput, DomainListEntry, DomainCommandResult } from './commands/domain-commands';

// Types
export type {
    ReflectionDomain,
    AnyDomain,
    FailureType,
    FailureRecord,
    DetectedPattern,
    ManifestPolicyRule,
    ReflectionConfig,
    PolicyRule,
    PolicyCondition,
    PolicyAction,
    AuditFinding,
} from './types';
export {
    FAILURE_TYPES_BY_DOMAIN,
    defaultReflectionConfig,
    generateFailureId,
    generatePolicyRuleId,
} from './types';
