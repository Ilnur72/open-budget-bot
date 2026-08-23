import { Body, Controller, ForbiddenException, Headers, HttpCode, Post } from '@nestjs/common';
import { BotService } from './bot.service';

@Controller('bot')
export class BotController {
  constructor(private readonly botService: BotService) {}

  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Headers('x-telegram-bot-api-secret-token') secretToken: string | undefined,
    @Body() update: Record<string, unknown>,
  ): Promise<void> {
    if (!this.botService.verifySecret(secretToken)) {
      throw new ForbiddenException();
    }
    await this.botService.handleUpdate(update);
  }
}
