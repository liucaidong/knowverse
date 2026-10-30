import { Controller, Get } from '@nestjs/common';
import { getLessons } from '@kv/domain';
import type { LessonsResponse } from '@kv/contracts';
@Controller('api')
export class LessonsController {
  @Get('lessons')
  list(): LessonsResponse { return getLessons(); }
  @Get('health')
  health(): { status: 'ok'; service: 'knowverse-api' } {
    return { status: 'ok', service: 'knowverse-api' };
  }
}
