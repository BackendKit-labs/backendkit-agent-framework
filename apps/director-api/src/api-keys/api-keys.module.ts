import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { ApiKey } from './entities/api-key.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApiKey]),
    forwardRef(() => AuthModule),
  ],
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeyAuthGuard, JwtAuthGuard],
  exports: [ApiKeysService, ApiKeyAuthGuard],
})
export class ApiKeysModule {}
