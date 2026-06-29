import { SetMetadata } from '@nestjs/common';

export const REQUIRE_TOOL_KEY = 'require_tool';

/**
 * Marca un endpoint con la(s) tool(s) cloud que el token debe portar para
 * autorizar la acción. Vocabulario compartido con auth-service (claim `tools[]`)
 * y con las scopes de las ApiKey M2M. Semántica OR: basta con una de las listadas.
 *
 * Ej: `@RequireTool('cloud_deploy')`, `@RequireTool('list_deployables')`.
 * Lo evalúa `AuthzGuard`. Ver `.specs/adr-unified-auth.md` (sub-fase 4b).
 */
export const RequireTool = (...tools: string[]) =>
  SetMetadata(REQUIRE_TOOL_KEY, tools);
