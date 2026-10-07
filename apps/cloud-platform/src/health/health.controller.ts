import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get()
  root() {
    return { name: 'cloud-platform', status: 'ok' };
  }

  @Get('health')
  check() {
    return { status: 'ok' };
  }
}
