import { Injectable } from '@nestjs/common';
import type { RuntimeKind } from '../runtime/runtime.spi';

/** A deployable agent blueprint: maps an agent type to an image + defaults. */
export interface AgentTemplate {
  key: string;
  displayName: string;
  description: string;
  image: string;
  runtime: RuntimeKind;
  command?: string[];
  env?: Record<string, string>;
  defaultModel?: string;
}

/** Base image used by all built-in templates until dedicated images exist. */
function baseImage(): string {
  return process.env.DEFAULT_AGENT_IMAGE ?? 'agent-runtime:latest';
}

type SeedEntry = {
  key: string;
  displayName: string;
  description: string;
  image?: string;
  runtime?: RuntimeKind;
  command?: string[];
  env?: Record<string, string>;
  defaultModel?: string;
};

const SEED: SeedEntry[] = [
  { key: 'backend', displayName: 'Backend', description: 'Implementación de backend/API.' },
  { key: 'qa', displayName: 'QA', description: 'Pruebas y aseguramiento de calidad.' },
  { key: 'design', displayName: 'Design', description: 'Diseño de arquitectura/UX.' },
  { key: 'security', displayName: 'Security', description: 'Revisión y hardening de seguridad.' },
  { key: 'infra', displayName: 'Infra', description: 'Infraestructura y despliegue.' },
  {
    key: 'codex',
    displayName: 'Knowledge Vault',
    description: 'Vault de conocimiento por proyecto con RAG (curar/buscar/leer notas).',
    image: 'knowledge-vault:latest',
    env: { CODEX_HTTP_PORT: '8080', CODEX_PROVIDER: 'anthropic' },
    defaultModel: 'claude-opus-4-8',
  },
  { key: 'custom', displayName: 'Custom', description: 'Agente genérico configurable.' },
];

/**
 * In-code registry of agent templates. Today every type runs the reference
 * `agent-runtime` image (distinguished by AGENT_TYPE); dedicated images can be
 * registered here as they are built, without touching the director.
 */
@Injectable()
export class AgentCatalog {
  private readonly templates = new Map<string, AgentTemplate>();

  constructor() {
    for (const t of SEED) {
      this.templates.set(t.key, {
        ...t,
        runtime: t.runtime ?? 'docker',
        image: t.image ?? baseImage(),
      });
    }
  }

  list(): AgentTemplate[] {
    return [...this.templates.values()];
  }

  get(key: string): AgentTemplate | undefined {
    return this.templates.get(key);
  }

  /** Resolve a type to its template, falling back to a generic one. */
  resolve(type: string): AgentTemplate {
    return (
      this.templates.get(type) ?? {
        key: type,
        displayName: type,
        description: 'Agente sin plantilla; usa la imagen por defecto.',
        image: baseImage(),
        runtime: 'docker',
      }
    );
  }
}
