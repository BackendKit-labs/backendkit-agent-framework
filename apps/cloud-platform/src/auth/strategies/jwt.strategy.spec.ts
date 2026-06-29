import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { UsersService } from '../../users/users.service';
import { UnauthorizedException } from '@nestjs/common';

describe('JwtStrategy', () => {
  let jwtStrategy: JwtStrategy;
  let usersService: UsersService;

  const mockConfigService = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'JWT_SECRET') return 'test-secret-key';
      return null;
    }),
  };

  const mockUsersService = {
    findById: jest.fn(),
  };

  // El constructor de JwtStrategy lee process.env.JWT_SECRET y lanza si falta.
  const originalJwtSecret = process.env.JWT_SECRET;
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-key';
  });
  afterAll(() => {
    process.env.JWT_SECRET = originalJwtSecret;
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    }).compile();

    jwtStrategy = module.get<JwtStrategy>(JwtStrategy);
    usersService = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validate', () => {
    it('should return user object when payload is valid and user exists', async () => {
      const payload = { sub: 'user-uuid-123', email: 'test@example.com' };
      const mockUser = {
        id: 'user-uuid-123',
        email: 'test@example.com',
        name: 'Test User',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      };

      mockUsersService.findById.mockResolvedValue(mockUser);

      const result = await jwtStrategy.validate(payload);

      expect(usersService.findById).toHaveBeenCalledWith('user-uuid-123');
      // validate proyecta solo id/email/name (nunca el hash ni timestamps).
      expect(result).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
      });
    });

    it('should throw UnauthorizedException when user is not found', async () => {
      const payload = { sub: 'nonexistent-uuid', email: 'unknown@example.com' };

      mockUsersService.findById.mockResolvedValue(null);

      await expect(jwtStrategy.validate(payload)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(usersService.findById).toHaveBeenCalledWith('nonexistent-uuid');
    });

    it('should throw UnauthorizedException when payload has no sub', async () => {
      const payload = { email: 'test@example.com' };
      mockUsersService.findById.mockResolvedValue(null);

      await expect(jwtStrategy.validate(payload as any)).rejects.toThrow(
        UnauthorizedException,
      );
      // No hay guard de sub: busca por undefined y falla al no encontrar usuario.
      expect(usersService.findById).toHaveBeenCalledWith(undefined);
    });
  });
});