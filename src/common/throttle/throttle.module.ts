import { Global, Module } from '@nestjs/common';
import { ThrottleService } from './throttle.service';

/** Global modul — chegaralash bot va HTTP qatlamlarida ham kerak. */
@Global()
@Module({
  providers: [ThrottleService],
  exports: [ThrottleService],
})
export class ThrottleModule {}
