import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { HcmAdapter } from './hcm.adapter';

@Module({
  imports: [HttpModule],
  providers: [HcmAdapter],
  exports: [HcmAdapter],
})
export class HcmModule {}
