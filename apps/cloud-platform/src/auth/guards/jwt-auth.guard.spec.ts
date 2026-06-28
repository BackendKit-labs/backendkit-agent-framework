import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: JwtService;
  let configService: ConfigService;

  const mockJwtService = {
    verify: jest.fn(),
    sign: jest.fn(),
    decode: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
    getOrThrow: jest.fn(),
  };

  const mockReflector = {
    get: jest.fn(),
    getAllAndOverride: jest.fn(),
    getAllAndMerge: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: Reflector,
          useValue: mockReflector,
        },
      ],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
    jwtService = module.get<JwtService>(JwtService);
    configService = module.get<ConfigService>(ConfigService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    let mockContext: ExecutionContext;
    let mockRequest: any;

    beforeEach(() => {
      mockRequest = {
        headers: {},
        user: null,
      };

      mockContext = {
        switchToHttp: jest.fn().mockReturnThis(),
        getRequest: jest.fn().mockReturnValue(mockRequest),
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as unknown as ExecutionContext;
    });

    it('should return true when valid token is provided', async () => {
      const validToken = 'valid.jwt.token';
      const decodedUser = { sub: 'user-uuid', email: 'test@example.com' };

      mockRequest.headers.authorization = `Bearer ${validToken}`;
      mockConfigService.get.mockReturnValue('test-secret');
      mockJwtService.verify.mockReturnValue(decodedUser);

      const result = await guard.canActivate(mockContext);

      expect(result).toBe(true);
      expect(mockConfigService.get).toHaveBeenCalledWith('JWT_SECRET');
      expect(mockJwtService.verify).toHaveBeenCalledWith(validToken, {
        secret: 'test-secret',
      });
    });

    it('should throw UnauthorizedException when no token is provided', async () => {
      await expect(guard.canActivate(mockContext)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockJwtService.verify).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when token has invalid format', async () => {
      mockRequest.headers.authorization = 'InvalidFormat';

      await expect(guard.canActivate(mockContext)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockJwtService.verify).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when token is expired', async () => {
      mockRequest.headers.authorization = 'Bearer expired.token.here';
      mockConfigService.get.mockReturnValue('test-secret');
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(guard.canActivate(mockContext)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockConfigService.get).toHaveBeenCalledWith('JWT_SECRET');
      expect(mockJwtService.verify).toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when token is malformed', async () => {
      mockRequest.headers.authorization = 'Bearer malformed-token';
      mockConfigService.get.mockReturnValue('test-secret');
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('jwt malformed');
      });

      await expect(guard.canActivate(mockContext)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when JWT_SECRET is not configured', async () => {
      mockRequest.headers.authorization = 'Bearer some.token.here';
      mockConfigService.get.mockReturnValue(undefined);

      await expect(guard.canActivate(mockContext)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when token verification fails with unknown error', async () => {
      mockRequest.headers.authorization = 'Bearer some.token.here';
      mockConfigService.get.mockReturnValue('test-secret');
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('unknown error');
      });

      await expect(guard.canActivate(mockContext)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should handle Bearer token with extra spaces', async () => {
      mockRequest.headers.authorization = 'Bearer   token.with.spaces   ';
      mockConfigService.get.mockReturnValue('test-secret');
      mockJwtService.verify.mockReturnValue({
        sub: 'user-uuid',
        email: 'test@example.com',
      });

      const result = await guard.canActivate(mockContext);

      expect(result).toBe(true);
      expect(mockJwtService.verify).toHaveBeenCalledWith(
        'token.with.spaces',
        expect.any(Object),
      );
    });
  });

  describe('handleRequest', () => {
    it('should return user when no error and user exists', () => {
      const user = { sub: 'user-uuid', email: 'test@example.com' };
      const result = guard.handleRequest(null, user);
      expect(result).toEqual(user);
    });

    it('should throw UnauthorizedException when error exists', () => {
      const error = new UnauthorizedException('Custom error');
      expect(() => guard.handleRequest(error, null)).toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when user is null', () => {
      expect(() => guard.handleRequest(null, null)).toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when user is undefined', () => {
      expect(() => guard.handleRequest(null, undefined)).toThrow(
        UnauthorizedException,
      );
    });

    it('should propagate the original error when it exists', () => {
      const error = new UnauthorizedException('Token expired');
      try {
        guard.handleRequest(error, null);
      } catch (e) {
        expect(e.message).toBe('Token expired');
      }
    });
  });
});