import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';

describe('UsersService', () => {
  let service: UsersService;
  let repository: jest.Mocked<Repository<User>>;

  const mockUser: User = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    email: 'test@example.com',
    password: '$2b$10$hashedpassword',
    name: 'Test User',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  };

  const mockRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    repository = module.get(getRepositoryToken(User));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should hash password with bcrypt and create a new user', async () => {
      const createUserDto = {
        email: 'new@example.com',
        password: 'plainpassword',
        name: 'New User',
      };

      const bcryptHashSpy = jest.spyOn(bcrypt, 'hash').mockResolvedValue('$2b$10$hashedpassword' as never);

      const createdUser = {
        ...mockUser,
        email: createUserDto.email,
        name: createUserDto.name,
        password: '$2b$10$hashedpassword',
      };

      mockRepository.create.mockReturnValue(createdUser);
      mockRepository.save.mockResolvedValue(createdUser);

      const result = await service.create(createUserDto);

      expect(bcryptHashSpy).toHaveBeenCalledWith('plainpassword', 10);
      expect(mockRepository.create).toHaveBeenCalledWith({
        email: createUserDto.email,
        password: '$2b$10$hashedpassword',
        name: createUserDto.name,
      });
      expect(mockRepository.save).toHaveBeenCalledWith(createdUser);
      expect(result).toEqual(createdUser);
    });

    it('should throw ConflictException if email already exists', async () => {
      const createUserDto = {
        email: 'existing@example.com',
        password: 'password123',
        name: 'Existing User',
      };

      mockRepository.findOne.mockResolvedValue(mockUser);

      await expect(service.create(createUserDto)).rejects.toThrow('Email already exists');
      expect(mockRepository.findOne).toHaveBeenCalledWith({ where: { email: createUserDto.email } });
      expect(mockRepository.create).not.toHaveBeenCalled();
      expect(mockRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('findByEmail', () => {
    it('should return a user when email exists', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.findByEmail('test@example.com');

      expect(mockRepository.findOne).toHaveBeenCalledWith({ where: { email: 'test@example.com' } });
      expect(result).toEqual(mockUser);
    });

    it('should return null when email does not exist', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.findByEmail('nonexistent@example.com');

      expect(mockRepository.findOne).toHaveBeenCalledWith({ where: { email: 'nonexistent@example.com' } });
      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('should return a user when id exists', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.findById(mockUser.id);

      expect(mockRepository.findOne).toHaveBeenCalledWith({ where: { id: mockUser.id } });
      expect(result).toEqual(mockUser);
    });

    it('should return null when id does not exist', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.findById('nonexistent-id');

      expect(mockRepository.findOne).toHaveBeenCalledWith({ where: { id: 'nonexistent-id' } });
      expect(result).toBeNull();
    });
  });
});