import { Module } from '@nestjs/common';
import { UserService } from './user.service';

/** Foydalanuvchilar moduli — PrismaModule global bo'lgani uchun import qilinmaydi. */
@Module({
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
