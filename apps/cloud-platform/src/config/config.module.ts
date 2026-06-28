import { Module } from '@nestjs/common';
import { DatabaseConfigService } from './database.config';
import { JwtConfigService } from './jwt.config';

@Module({
  providers: [DatabaseConfigService, JwtConfigService],
  exports: [DatabaseConfigService, JwtConfigService],
})
export class ConfigModule {}