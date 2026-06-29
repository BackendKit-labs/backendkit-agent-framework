import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class AbacClientService {
  private readonly logger = new Logger(AbacClientService.name);
  private readonly baseUrl =
    (process.env.ABAC_BASE_URL ?? 'http://localhost:3005').replace(/\/$/, '');
  private readonly m2mToken = process.env.ABAC_M2M_TOKEN ?? '';
  private readonly appId = process.env.ABAC_APP_ID ?? '';

  /**
   * Llama al PDP de abac-service para decidir si `userId` puede ejecutar
   * `action` sobre `resource` en el contexto dado.
   * Falla cerrado: cualquier error de red retorna `false`.
   */
  async canAccess(
    userId: string,
    resource: string,
    action: string,
    context?: Record<string, unknown>,
  ): Promise<boolean> {
    if (!this.m2mToken || !this.appId) {
      this.logger.warn(
        'ABAC_M2M_TOKEN o ABAC_APP_ID no configurados — denegando por defecto',
      );
      return false;
    }

    try {
      const response = await fetch(`${this.baseUrl}/abac/can-access`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.m2mToken}`,
        },
        body: JSON.stringify({ userId, applicationId: this.appId, resource, action, context }),
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) {
        this.logger.warn(
          `ABAC PDP respondió ${response.status} para ${resource}:${action} — denegando`,
        );
        return false;
      }

      const data = (await response.json()) as { granted: boolean };
      return data.granted === true;
    } catch (err: any) {
      this.logger.error(
        `ABAC PDP inalcanzable — denegando ${resource}:${action}: ${err?.message}`,
      );
      return false;
    }
  }
}
