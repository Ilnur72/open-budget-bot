import { Controller, Get, Header } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  @Header('Cache-Control', 'no-store')
  liveness() {
    return { status: 'ok', uptime: Math.floor(process.uptime()) };
  }
}
