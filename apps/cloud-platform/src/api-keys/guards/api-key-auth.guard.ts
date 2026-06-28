import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { ApiKeysService } from '../api-keys.service';

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const plainKey = request.headers['x-api-key'];
    if (!plainKey || typeof plainKey !== 'string') return false;

    const apiKey = await this.apiKeysService.validate(plainKey);
    if (!apiKey) return false;

    request.apiKey = apiKey;
    return true;
  }
}
