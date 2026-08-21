import { Module } from '@nestjs/common';
import { OpenBudgetModule } from '../openbudget/openbudget.module';
import { CaptchaController } from './captcha.controller';

/** Captcha Mini App'ga xizmat qiluvchi HTTP qatlami. */
@Module({
  imports: [OpenBudgetModule],
  controllers: [CaptchaController],
})
export class WebappModule {}
