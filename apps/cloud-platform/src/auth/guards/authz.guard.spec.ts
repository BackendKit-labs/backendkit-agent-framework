import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthzGuard } from './authz.guard';
import { AbacClientService } from '../../abac/abac-client.service';

describe('AuthzGuard', () => {
  let guard: AuthzGuard;
  let reflector: Reflector;
  let mockAbacClient: jest.Mocked<Pick<AbacClientService, 'canAccess'>>;

  const ctxWith = (request: any): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    }) as unknown as ExecutionContext;

  const requirePermission = (perm: string) =>
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(perm);

  beforeEach(() => {
    reflector = new Reflector();
    mockAbacClient = { canAccess: jest.fn().mockResolvedValue(false) };
    guard = new AuthzGuard(reflector, mockAbacClient as unknown as AbacClientService);
  });

  it('permite cuando el endpoint no declara @RequirePermission', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(await guard.canActivate(ctxWith({ user: { id: 'u1', org: 'org-1' } }))).toBe(true);
  });

  describe('Bearer EdDSA (abac-service) → llama al PDP', () => {
    it('permite cuando el PDP retorna true', async () => {
      requirePermission('deployable:deploy');
      mockAbacClient.canAccess.mockResolvedValue(true);
      const ctx = ctxWith({ user: { id: 'u1', org: 'org-uuid' } });
      expect(await guard.canActivate(ctx)).toBe(true);
      expect(mockAbacClient.canAccess).toHaveBeenCalledWith(
        'u1', 'deployable', 'deploy', { organizationId: 'org-uuid' },
      );
    });

    it('lanza Forbidden cuando el PDP retorna false', async () => {
      requirePermission('deployable:deploy');
      mockAbacClient.canAccess.mockResolvedValue(false);
      const ctx = ctxWith({ user: { id: 'u1', org: 'org-uuid' } });
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('llama al PDP con organizationId null cuando org no está en el token', async () => {
      requirePermission('deployable:deploy');
      mockAbacClient.canAccess.mockResolvedValue(true);
      const ctx = ctxWith({ user: { id: 'u1' } });
      await guard.canActivate(ctx);
      expect(mockAbacClient.canAccess).toHaveBeenCalledWith(
        'u1', 'deployable', 'deploy', { organizationId: null },
      );
    });
  });

  describe('M2M ApiKey', () => {
    it('permite con scope comodín "*"', async () => {
      requirePermission('deployable:deploy');
      expect(await guard.canActivate(ctxWith({ apiKey: { scopes: ['*'] } }))).toBe(true);
    });

    it('permite con scopes null (todas permitidas)', async () => {
      requirePermission('deployable:deploy');
      expect(await guard.canActivate(ctxWith({ apiKey: { scopes: null } }))).toBe(true);
    });

    it('permite cuando scopes incluye el permiso exacto', async () => {
      requirePermission('deployable:deploy');
      expect(
        await guard.canActivate(ctxWith({ apiKey: { scopes: ['deployable:deploy'] } })),
      ).toBe(true);
    });

    it('lanza Forbidden cuando scopes no incluye el permiso', async () => {
      requirePermission('deployable:deploy');
      await expect(
        guard.canActivate(ctxWith({ apiKey: { scopes: ['vault:search'] } })),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  it('lanza Forbidden sin contexto de autenticación', async () => {
    requirePermission('deployable:deploy');
    await expect(guard.canActivate(ctxWith({}))).rejects.toThrow(ForbiddenException);
  });
});
