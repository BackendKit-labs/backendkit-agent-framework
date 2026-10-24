# Specs

Especificaciones de cambios que afectan a varios paquetes. Cada spec enlaza los ADR que justifican sus decisiones; el ADR explica el porqué, el spec explica el qué y el cómo.

| Spec | Título | Estado |
|---|---|---|
| [SPEC-0001](SPEC-0001-agent-core-ola-1.md) | Ola 1 de capacidades de agent-core | Implementado (core 0.27) |
| [SPEC-0002](SPEC-0002-agent-core-ola-3a.md) | Ola 3a: señal y plazo por tool, reintento tras desbordamiento, credenciales por referencia, jobs | Borrador |
| [SPEC-0003](SPEC-0003-hermes-plano-de-control.md) | Hermes: plano de control de agentes | Borrador |
| [SPEC-0004](SPEC-0004-agent-session.md) | agent-session: log de sesión orientado a eventos | Borrador |
| [SPEC-0005](SPEC-0005-agent-subagents-y-agent-acp.md) | agent-subagents y agent-acp | Borrador |
| [SPEC-0006](SPEC-0006-agent-sandbox.md) | agent-sandbox: confinamiento y permisos | Borrador |
| [SPEC-0007](SPEC-0007-agent-testkit-y-agent-autonomy.md) | agent-testkit y agent-autonomy | Borrador |
| [SPEC-0008](SPEC-0008-hermes-plan-de-implementacion.md) | Hermes: plan de implementación (H0 → H1c) | P1–P6 publicados (hermes 0.2) |
| [SPEC-0009](SPEC-0009-confianza-del-workspace-y-limites-aplicados.md) | Confianza del workspace y límites aplicados | Borrador |

Orden de ejecución propuesto: 0002 → 0007 (testkit) → 0006 → 0005 (one-shot, ACP) → 0003 H0/H1 → 0004 → 0005 (continuables) y 0007 (autonomía) → 0003 H3/H4.

Estados: Borrador, En revisión, Aprobado, Implementado.
