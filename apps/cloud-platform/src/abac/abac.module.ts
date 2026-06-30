import { Global, Module } from '@nestjs/common';
import { AbacClientService } from './abac-client.service';

@Global()
@Module({
  providers: [AbacClientService],
  exports: [AbacClientService],
})
export class AbacModule {}
