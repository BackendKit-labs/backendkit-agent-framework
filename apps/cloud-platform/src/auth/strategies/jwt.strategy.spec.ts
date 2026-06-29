import { Test, TestingModule } from '@nestjs/testing';
import { JwtStrategy } from './jwt.strategy';
import { UnauthorizedException } from '@nestjs/common';

describe('JwtStrategy', () => {
  let jwtStrategy: JwtStrategy;

  // El constructor lee AUTH_SECRET y lanza si falta.
  const originalAuthSecret = process.env.AUTH_SECRET;
  beforeAll(() => {
    process.env.AUTH_SECRET = 'test-auth-secret';
  });
  afterAll(() => {
    process.env.AUTH_SECRET = originalAuthSecret;
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [JwtStrategy],
    }).compile();

    jwtStrategy = module.get<JwtStrategy>(JwtStrategy);
  });

  describe('validate', () => {
    it('proyecta los claims de auth-service a req.user sin lookup a DB', async () => {
      const payload = {
        sub: 'user-uuid-123',
        role: 'development',
        dept: 'backend',
        tools: ['cloud_deploy', 'cloud_stop'],
        vault: ['backend/'],
        apps: ['director'],
        email: 'test@example.com',
      };

      const result = await jwtStrategy.validate(payload);

      expect(result).toEqual({
        id: 'user-uuid-123',
        role: 'development',
        dept: 'backend',
        tools: ['cloud_deploy', 'cloud_stop'],
        vault: ['backend/'],
        apps: ['director'],
        email: 'test@example.com',
      });
    });

    it('aplica defaults cuando faltan claims opcionales', async () => {
      const result = await jwtStrategy.validate({ sub: 'user-uuid-123' });

      expect(result).toEqual({
        id: 'user-uuid-123',
        role: null,
        dept: null,
        tools: [],
        vault: [],
        apps: [],
        email: null,
      });
    });

    it('lanza UnauthorizedException cuando el payload no tiene sub', async () => {
      await expect(
        jwtStrategy.validate({ email: 'test@example.com' } as any),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
