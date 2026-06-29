import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

jest.mock('bcrypt');

const TOKEN = 'jwt.token.here';

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let jwtService: jest.Mocked<JwtService>;

  const mockUser = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    email: 'test@example.com',
    password: '$2b$10$hashedpassword',
    name: 'Test User',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  };

  const mockUserWithoutPassword = {
    id: mockUser.id,
    email: mockUser.email,
    name: mockUser.name,
    createdAt: mockUser.createdAt,
    updatedAt: mockUser.updatedAt,
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            create: jest.fn(),
          },
        },
        {
          provide: JwtService,
          // AuthService.signToken usa jwtService.sign (síncrono), no signAsync.
          useValue: {
            sign: jest.fn(() => TOKEN),
          },
        },
        {
          provide: ConfigService,
          // El constructor exige JWT_SECRET; sin él lanza al instanciar.
          useValue: {
            get: jest.fn((key: string) => (key === 'JWT_SECRET' ? 'test-secret' : undefined)),
          },
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);

    jest.clearAllMocks();
    (jwtService.sign as jest.Mock).mockReturnValue(TOKEN);
  });

  describe('register', () => {
    it('creates a user and returns token + user without password', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$10$hashedpassword');
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue(mockUser);

      const result = await authService.register(mockRegisterDto);

      expect(usersService.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10);
      expect(usersService.create).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: '$2b$10$hashedpassword',
        name: 'Test User',
      });
      expect(result.accessToken).toBe(TOKEN);
      expect(result.user).toEqual(mockUserWithoutPassword);
      expect(result.user).not.toHaveProperty('password');
    });

    it('throws ConflictException if email already exists', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser);

      await expect(authService.register(mockRegisterDto)).rejects.toThrow(ConflictException);
      expect(usersService.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(bcrypt.hash).not.toHaveBeenCalled();
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException with correct message', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser);

      await expect(authService.register(mockRegisterDto)).rejects.toThrow('Email already exists');
    });
  });

  describe('login', () => {
    it('returns accessToken and user when credentials are valid', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await authService.login(mockLoginDto);

      expect(usersService.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(bcrypt.compare).toHaveBeenCalledWith('password123', mockUser.password);
      expect(jwtService.sign).toHaveBeenCalled();
      expect(result.accessToken).toBe(TOKEN);
      expect(result.user).toEqual(mockUserWithoutPassword);
      expect(result.user).not.toHaveProperty('password');
    });

    it('throws UnauthorizedException when user is not found', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(authService.login(mockLoginDto)).rejects.toThrow(UnauthorizedException);
      expect(usersService.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(bcrypt.compare).not.toHaveBeenCalled();
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when password is invalid', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(authService.login(mockLoginDto)).rejects.toThrow(UnauthorizedException);
      expect(bcrypt.compare).toHaveBeenCalledWith('password123', mockUser.password);
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException with correct message for invalid credentials', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(authService.login(mockLoginDto)).rejects.toThrow('Invalid credentials');
    });
  });
});
