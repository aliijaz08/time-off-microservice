import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeaveRequest } from './leave-request.entity';
import { Balance } from '../balance/balance.entity';
import { Employee } from '../employee/employee.entity';
import { Location } from '../location/location.entity';
import { LeaveRequestService } from './leave-request.service';
import { LeaveRequestController } from './leave-request.controller';
import { HcmModule } from '../hcm/hcm.module';

@Module({
  imports: [TypeOrmModule.forFeature([LeaveRequest, Balance, Employee, Location]), HcmModule],
  providers: [LeaveRequestService],
  controllers: [LeaveRequestController],
})
export class LeaveRequestModule {}
