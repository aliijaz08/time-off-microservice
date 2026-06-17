import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ROLES_KEY } from './roles.decorator';
import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  role: string;
  requesterId?: string;
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const apiKey = request.headers['x-api-key'] as string | undefined;

    const employeeKey = this.config.get<string>('EMPLOYEE_API_KEY');
    const managerKey = this.config.get<string>('MANAGER_API_KEY');
    const systemKey = this.config.get<string>('SYSTEM_API_KEY');

    let role: string | null = null;
    if (apiKey && apiKey === employeeKey) role = 'employee';
    else if (apiKey && apiKey === managerKey) role = 'manager';
    else if (apiKey && apiKey === systemKey) role = 'system';

    if (!role) throw new UnauthorizedException('Invalid or missing API key');

    request.role = role;

    if (role === 'employee') {
      const employeeId = request.headers['x-employee-id'] as string | undefined;
      if (!employeeId) throw new UnauthorizedException('X-Employee-ID header required for employee role');
      request.requesterId = employeeId;
    }

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) return true;
    if (!requiredRoles.includes(role)) throw new ForbiddenException('Insufficient permissions');

    return true;
  }
}
