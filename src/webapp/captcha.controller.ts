import {
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottleService } from '../common/throttle/throttle.service';
import { VoteSessionStore } from '../openbudget/vote-session.store';
import { verifyInitData } from './init-data.util';

/** Bitta foydalanuvchi captchani daqiqada necha marta so'ray oladi. */
const MAX_REQUESTS_PER_WINDOW = 10;
const WINDOW_SECONDS = 60;

const THROTTLE_KEY_PREFIX = 'webapp:captcha';

/**
 * Bitta rasm hajmi chegarasi.
 * openbudget.uz kutilmaganda katta rasm qaytarsa, endpoint kuchaytirish
 * (amplification) vositasiga aylanib qolmasligi kerak.
 */
const MAX_IMAGE_BYTES = 512 * 1024;

/** WebApp'ga beriladigan captcha — maxfiy `captchaKey` bu yerda YO'Q. */
interface CaptchaResponse {
  imageA: string;
  imageB: string;
}

/**
 * Captcha Mini App uchun HTTP endpoint.
 *
 * Spetsifikatsiyadan ikkita muhim farq bor:
 *
 * 1. Captcha bu yerda QAYTA SO'RALMAYDI. `VoteFlowService.prepareCaptcha()`
 *    uni allaqachon olib sessiyaga yozgan. Qayta so'ralsa openbudget.uz boshqa
 *    `captchaKey` beradi va foydalanuvchi yechgan rasm bilan yuboriladigan
 *    kalit mos kelmay, ovoz hech qachon o'tmasdi.
 *
 * 2. Endpoint `initData` imzosi bilan himoyalangan. Aks holda uni istalgan kim
 *    chaqirib, openbudget.uz ga yuk tashlashi mumkin edi.
 */
@Controller('api')
export class CaptchaController {
  private readonly logger = new Logger(CaptchaController.name);

  constructor(
    private readonly sessionStore: VoteSessionStore,
    private readonly configService: ConfigService,
    private readonly throttle: ThrottleService,
  ) {}

  @Get('captcha')
  @HttpCode(HttpStatus.OK)
  // Javob foydalanuvchiga xos, URL esa hamma uchun bir xil — oraliq kesh
  // A ning rasmlarini B ga berib yuborishi mumkin edi.
  @Header('Cache-Control', 'no-store')
  @Header('Vary', 'X-Telegram-Init-Data')
  async getCaptcha(
    // Telegram WebApp `initData` shu sarlavhada keladi.
    @Headers('x-telegram-init-data') initData?: string,
  ): Promise<CaptchaResponse> {
    const user = verifyInitData(initData ?? '', this.configService.getOrThrow<string>('bot.token'));

    if (user === null) {
      // `warn` emas: tasdiqlanmagan so'rovlar flood'i log'ni to'ldirmasin.
      this.logger.debug("Captcha so'rovi tasdiqlanmagan initData bilan keldi");
      throw new HttpException({ error: 'UNAUTHORIZED' }, HttpStatus.UNAUTHORIZED);
    }

    const throttled = await this.throttle.isExceeded(
      `${THROTTLE_KEY_PREFIX}:${user.id}`,
      MAX_REQUESTS_PER_WINDOW,
      WINDOW_SECONDS,
    );
    if (throttled) {
      throw new HttpException({ error: 'TOO_MANY_REQUESTS' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const session = await this.sessionStore.get(user.id);
    if (session === null) {
      throw new HttpException({ error: 'SESSION_NOT_FOUND' }, HttpStatus.NOT_FOUND);
    }

    if (isTooLarge(session.imageA) || isTooLarge(session.imageB)) {
      this.logger.warn(`Captcha rasmi juda katta: telegramId=${user.id}`);
      throw new HttpException({ error: 'CAPTCHA_TOO_LARGE' }, HttpStatus.BAD_GATEWAY);
    }

    return { imageA: session.imageA, imageB: session.imageB };
  }
}

function isTooLarge(image: string): boolean {
  return Buffer.byteLength(image, 'utf8') > MAX_IMAGE_BYTES;
}
