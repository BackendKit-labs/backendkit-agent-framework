import { Module } from '@nestjs/common';
import { VaultService } from './vault.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [VaultService],
  exports: [VaultService],
})
export class VaultModule {}