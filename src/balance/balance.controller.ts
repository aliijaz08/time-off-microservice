import { Controller, Get, Param, Req, ForbiddenException } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { Roles } from '../auth/roles.decorator';

@Controller()
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

  @Roles('employee', 'manager')
  @Get('balances/:employeeId/:locationId')
  getOne(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
    @Req() req: any,
  ) {
    if (req.role === 'employee' && req.requesterId !== employeeId) {
      throw new ForbiddenException("Cannot access another employee's balance");
    }
    return this.balanceService.getOne(employeeId, locationId);
  }

  @Roles('employee', 'manager')
  @Get('balances/:employeeId')
  getAll(@Param('employeeId') employeeId: string, @Req() req: any) {
    if (req.role === 'employee' && req.requesterId !== employeeId) {
      throw new ForbiddenException("Cannot access another employee's balances");
    }
    return this.balanceService.getAll(employeeId);
  }

  @Roles('manager')
  @Get('admin/flagged-balances')
  getFlagged() {
    return this.balanceService.getFlagged();
  }
}
