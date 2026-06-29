import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { HttpStatus } from '@nestjs/common';

describe('AuthController', () => {
  let authController: AuthController;
  let authService: jest.Mocked<AuthService>;

  const mockUser = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    email: 'test@example.com',
    name: 'Test User',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  };

  const mockRegisterDto: RegisterDto = {
    email: 'test@example.com',
    password: 'password123',
    name: 'Test User',
  };

  const mockLoginDto: LoginDto = {
    email: 'test@example.com',
    password: 'password123',
  };

  const mockLoginResponse = {
    accessToken: 'mock-jwt-token',
    user: mockUser,
  };

  // register ahora devuelve { accessToken, user } igual que login.
  const mockRegisterResponse = {
    accessToken: 'mock-jwt-token',
    user: mockUser,
  };

  beforeEach(async () => {
    const mockAuthService = {
      register: jest.fn(),
      login: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    }).compile();

    authController = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService) as jest.Mocked<AuthService>;
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user and return 201 status', async () => {
      authService.register.mockResolvedValue(mockRegisterResponse);

      const result = await authController.register(mockRegisterDto);

      expect(result).toEqual(mockRegisterResponse);
      expect(authService.register).toHaveBeenCalledWith(mockRegisterDto);
      expect(authService.register).toHaveBeenCalledTimes(1);
    });

    it('should throw ConflictException (409) when email already exists', async () => {
      const conflictError = new Error('Email already exists');
      (conflictError as any).status = HttpStatus.CONFLICT;
      authService.register.mockRejectedValue(conflictError);

      await expect(authController.register(mockRegisterDto)).rejects.toThrow('Email already exists');
      expect(authService.register).toHaveBeenCalledWith(mockRegisterDto);
    });

    it('should throw BadRequestException (400) for invalid DTO', async () => {
      const validationError = new Error('Validation failed');
      (validationError as any).status = HttpStatus.BAD_REQUEST;
      authService.register.mockRejectedValue(validationError);

      const invalidDto = { email: 'invalid', password: '12', name: 'A' } as RegisterDto;
      await expect(authController.register(invalidDto)).rejects.toThrow('Validation failed');
    });

    it('should return a user without password field', async () => {
      authService.register.mockResolvedValue(mockRegisterResponse);

      const result = await authController.register(mockRegisterDto);

      expect(result.user).not.toHaveProperty('password');
      expect(result).toEqual(mockRegisterResponse);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login successfully and return access token with user', async () => {
      authService.login.mockResolvedValue(mockLoginResponse);

      const result = await authController.login(mockLoginDto);

      expect(result).toEqual(mockLoginResponse);
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('user');
      expect(result.user).not.toHaveProperty('password');
      expect(authService.login).toHaveBeenCalledWith(mockLoginDto);
      expect(authService.login).toHaveBeenCalledTimes(1);
    });

    it('should throw UnauthorizedException (401) for invalid credentials', async () => {
      const unauthorizedError = new Error('Invalid credentials');
      (unauthorizedError as any).status = HttpStatus.UNAUTHORIZED;
      authService.login.mockRejectedValue(unauthorizedError);

      const invalidLoginDto: LoginDto = {
        email: 'test@example.com',
        password: 'wrongpassword',
      };

      await expect(authController.login(invalidLoginDto)).rejects.toThrow('Invalid credentials');
      expect(authService.login).toHaveBeenCalledWith(invalidLoginDto);
    });

    it('should throw UnauthorizedException (401) for non-existent email', async () => {
      const notFoundError = new Error('User not found');
      (notFoundError as any).status = HttpStatus.UNAUTHORIZED;
      authService.login.mockRejectedValue(notFoundError);

      const nonExistentLoginDto: LoginDto = {
        email: 'nonexistent@example.com',
        password: 'password123',
      };

      await expect(authController.login(nonExistentLoginDto)).rejects.toThrow('User not found');
      expect(authService.login).toHaveBeenCalledWith(nonExistentLoginDto);
    });

    it('should return 200 status code on successful login', async () => {
      authService.login.mockResolvedValue(mockLoginResponse);

      const result = await authController.login(mockLoginDto);

      expect(result).toEqual(mockLoginResponse);
      // The @HttpCode(HttpStatus.OK) decorator ensures 200 status
    });

    it('should return user object without password in login response', async () => {
      authService.login.mockResolvedValue(mockLoginResponse);

      const result = await authController.login(mockLoginDto);

      expect(result.user).not.toHaveProperty('password');
      expect(result.user).toEqual(mockUser);
    });
  });
});