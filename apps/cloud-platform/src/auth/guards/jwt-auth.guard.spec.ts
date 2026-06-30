import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard();
  });

  describe('handleRequest', () => {
    it('should return user when no error and user exists', () => {
      const user = { id: 'user-uuid', email: 'test@example.com' };
      expect(guard.handleRequest(null, user)).toEqual(user);
    });

    it('should throw UnauthorizedException when user is null', () => {
      expect(() => guard.handleRequest(null, null)).toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user is undefined', () => {
      expect(() => guard.handleRequest(null, undefined)).toThrow(UnauthorizedException);
    });

    it('should propagate the original error when one is provided', () => {
      const error = new UnauthorizedException('Token expired');
      expect(() => guard.handleRequest(error, null)).toThrow('Token expired');
    });
  });
});
