import { UnauthorizedException } from '@nestjs/common';
import { EdDsaJwtStrategy } from './eddsa-jwt.strategy';

describe('EdDsaJwtStrategy', () => {
  let strategy: EdDsaJwtStrategy;

  beforeEach(() => {
    strategy = new EdDsaJwtStrategy();
  });

  describe('validate', () => {
    it('should return DirectorUser from a valid abac-service payload', async () => {
      const payload = {
        sub: 'user-uuid-123',
        email: 'admin@example.com',
        org: 'org-uuid-456',
        orgSlug: 'acme',
        roles: ['admin'],
        permissions: ['deployable:deploy', 'vault:search'],
      };

      const result = await strategy.validate(payload);

      expect(result).toEqual({
        id: 'user-uuid-123',
        email: 'admin@example.com',
        org: 'org-uuid-456',
        orgSlug: 'acme',
        roles: ['admin'],
        permissions: ['deployable:deploy', 'vault:search'],
      });
    });

    it('should use null defaults when optional claims are absent', async () => {
      const payload = { sub: 'user-uuid-123' };

      const result = await strategy.validate(payload);

      expect(result.id).toBe('user-uuid-123');
      expect(result.email).toBeNull();
      expect(result.org).toBeNull();
      expect(result.orgSlug).toBeNull();
      expect(result.roles).toEqual([]);
      expect(result.permissions).toEqual([]);
    });

    it('should throw UnauthorizedException when sub is missing', async () => {
      await expect(strategy.validate({} as any)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
