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

  const requireTool = (...tools: string[]) =>
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(tools);

  beforeEach(() => {
    reflector = new Reflector();
    mockAbacClient = { canAccess: jest.fn().mockResolvedValue(false) };
    guard = new AuthzGuard(reflector, mockAbacClient as unknown as AbacClientService);
  });

  it('permite cuando el endpoint no declara permiso requerido', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(await guard.canActivate(ctxWith({ user: { tools: [] } }))).toBe(true);
  });

  describe('JWT humano (auth-service — tools[])', () => {
    it('permite cuando user.tools incluye la tool requerida', async () => {
      requireTool('cloud_deploy');
      const ctx = ctxWith({ user: { tools: ['cloud_deploy', 'cloud_stop'] } });
      expect(await guard.canActivate(ctx)).toBe(true);
    });

    it('lanza Forbidden cuando user.tools no incluye la tool', async () => {
      requireTool('cloud_deploy');
      const ctx = ctxWith({ user: { tools: ['cloud_metrics'] } });
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('lanza Forbidden cuando user no tiene tools', async () => {
      requireTool('cloud_deploy');
      await expect(guard.canActivate(ctxWith({ user: {} }))).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('JWT abac-service (con claim org) + @RequirePermission → llama al PDP', () => {
    it('permite cuando el PDP retorna allowed=true', async () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValueOnce('deployable:deploy') // REQUIRE_PERMISSION_KEY
        .mockReturnValueOnce(undefined);           // REQUIRE_TOOL_KEY
      mockAbacClient.canAccess.mockResolvedValue(true);
      const ctx = ctxWith({ user: { id: 'u1', org: 'org-uuid', tools: [] } });
      expect(await guard.canActivate(ctx)).toBe(true);
      expect(mockAbacClient.canAccess).toHaveBeenCalledWith(
        'u1', 'deployable', 'deploy', { organizationId: 'org-uuid' },
      );
    });

    it('lanza Forbidden cuando el PDP retorna allowed=false', async () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValueOnce('deployable:deploy')
        .mockReturnValueOnce(undefined);
      mockAbacClient.canAccess.mockResolvedValue(false);
      const ctx = ctxWith({ user: { id: 'u1', org: 'org-uuid', tools: [] } });
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('no llama al PDP cuando org es undefined (token auth-service)', async () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValueOnce('deployable:deploy')
        .mockReturnValueOnce(undefined);
      const ctx = ctxWith({ user: { id: 'u1', tools: ['deployable:deploy'] } });
      expect(await guard.canActivate(ctx)).toBe(true);
      expect(mockAbacClient.canAccess).not.toHaveBeenCalled();
    });
  });

  describe('M2M ApiKey', () => {
    it('permite con scope comodín "*"', async () => {
      requireTool('cloud_deploy');
      const ctx = ctxWith({ apiKey: { scopes: ['*'] } });
      expect(await guard.canActivate(ctx)).toBe(true);
    });

    it('permite con scopes null (todas permitidas)', async () => {
      requireTool('cloud_deploy');
      expect(await guard.canActivate(ctxWith({ apiKey: { scopes: null } }))).toBe(true);
    });

    it('permite cuando scopes incluye la tool exacta', async () => {
      requireTool('cloud_deploy');
      const ctx = ctxWith({ apiKey: { scopes: ['cloud_deploy'] } });
      expect(await guard.canActivate(ctx)).toBe(true);
    });

    it('lanza Forbidden cuando scopes no incluye la tool', async () => {
      requireTool('cloud_deploy');
      const ctx = ctxWith({ apiKey: { scopes: ['cloud_metrics'] } });
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });

  it('lanza Forbidden sin contexto de autenticación', async () => {
    requireTool('cloud_deploy');
    await expect(guard.canActivate(ctxWith({}))).rejects.toThrow(ForbiddenException);
  });
});
