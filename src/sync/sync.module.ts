import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Balance } from '../balance/balance.entity';
import { LeaveRequest } from '../leave-request/leave-request.entity';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { HcmModule } from '../hcm/hcm.module';

@Module({
  imports: [TypeOrmModule.forFeature([Balance, LeaveRequest]), HcmModule],
  providers: [SyncService],
  controllers: [SyncController],
  exports: [SyncService],
})
export class SyncModule {}
