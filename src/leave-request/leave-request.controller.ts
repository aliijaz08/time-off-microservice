import {
  Controller, Post, Get, Delete, Patch,
  Body, Param, Query, Headers, Req, ForbiddenException,
} from '@nestjs/common';
import { LeaveRequestService } from './leave-request.service';
import { LeaveStatus } from './leave-request.entity';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { ResolveLeaveRequestDto } from './dto/resolve-leave-request.dto';
import { Roles } from '../auth/roles.decorator';

@Controller('leave-requests')
export class LeaveRequestController {
  constructor(private readonly service: LeaveRequestService) {}

  @Roles('employee')
  @Post()
  submit(@Body() dto: CreateLeaveRequestDto, @Req() req: any) {
    if (dto.employeeId !== req.requesterId) {
      throw new ForbiddenException('Cannot submit leave for another employee');
    }
    return this.service.submit(dto);
  }

  @Roles('employee', 'manager')
  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.service.findOne(id, req.role === 'employee' ? req.requesterId : undefined);
  }

  @Roles('employee', 'manager')
  @Get()
  findAll(
    @Query('employeeId') employeeId: string | undefined,
    @Query('status') status: LeaveStatus | undefined,
    @Req() req: any,
  ) {
    if (req.role === 'employee') {
      return this.service.findAll({ employeeId: req.requesterId, status });
    }
    return this.service.findAll({ employeeId, status });
  }

  @Roles('employee')
  @Delete(':id')
  cancel(@Param('id') id: string, @Req() req: any) {
    return this.service.cancel(id, req.requesterId as string);
  }

  @Roles('manager')
  @Patch(':id/approve')
  approve(@Param('id') id: string, @Headers('x-manager-id') managerId: string) {
    return this.service.approve(id, managerId ?? 'unknown');
  }

  @Roles('manager')
  @Patch(':id/reject')
  reject(
    @Param('id') id: string,
    @Headers('x-manager-id') managerId: string,
    @Body() body: ResolveLeaveRequestDto,
  ) {
    return this.service.reject(id, managerId ?? 'unknown', body.note);
  }
}
