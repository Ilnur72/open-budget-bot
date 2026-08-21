import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Global modul — har bir feature modulda qayta import qilish shart emas. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
