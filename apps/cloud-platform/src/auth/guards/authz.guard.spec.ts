import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthzGuard } from './authz.guard';

describe('AuthzGuard', () => {
  let guard: AuthzGuard;
  let reflector: Reflector;

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
    guard = new AuthzGuard(reflector);
  });

  it('permite cuando el endpoint no declara tool requerida', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(ctxWith({ user: { tools: [] } }))).toBe(true);
  });

  describe('JWT humano', () => {
    it('permite cuando user.tools incluye la tool requerida', () => {
      requireTool('cloud_deploy');
      const ctx = ctxWith({ user: { tools: ['cloud_deploy', 'cloud_stop'] } });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('lanza Forbidden cuando user.tools no incluye la tool', () => {
      requireTool('cloud_deploy');
      const ctx = ctxWith({ user: { tools: ['cloud_metrics'] } });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('lanza Forbidden cuando user no tiene tools', () => {
      requireTool('cloud_deploy');
      expect(() => guard.canActivate(ctxWith({ user: {} }))).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('M2M ApiKey', () => {
    it('permite con scope comodín "*"', () => {
      requireTool('cloud_deploy');
      const ctx = ctxWith({ apiKey: { scopes: ['*'] } });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('permite con scopes null (todas permitidas)', () => {
      requireTool('cloud_deploy');
      expect(guard.canActivate(ctxWith({ apiKey: { scopes: null } }))).toBe(
        true,
      );
    });

    it('permite cuando scopes incluye la tool exacta', () => {
      requireTool('cloud_deploy');
      const ctx = ctxWith({ apiKey: { scopes: ['cloud_deploy'] } });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('lanza Forbidden cuando scopes no incluye la tool', () => {
      requireTool('cloud_deploy');
      const ctx = ctxWith({ apiKey: { scopes: ['cloud_metrics'] } });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });
  });

  it('lanza Forbidden sin contexto de autenticación', () => {
    requireTool('cloud_deploy');
    expect(() => guard.canActivate(ctxWith({}))).toThrow(ForbiddenException);
  });
});
