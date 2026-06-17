import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ApiKeyGuard } from './api-key.guard';

function makeContext(
  headers: Record<string, string>,
  roles?: string[],
  isPublic?: boolean,
): { ctx: ExecutionContext; request: Record<string, unknown> } {
  const request: Record<string, unknown> = { headers };
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => {
      if (key === 'isPublic') return isPublic ?? false;
      if (key === 'roles') return roles;
      return undefined;
    }),
  } as unknown as Reflector;
  const config = {
    get: jest.fn((key: string) => {
      const map: Record<string, string> = {
        EMPLOYEE_API_KEY: 'emp-key',
        MANAGER_API_KEY:  'mgr-key',
        SYSTEM_API_KEY:   'sys-key',
      };
      return map[key];
    }),
  } as unknown as ConfigService;
  const guard = new ApiKeyGuard(reflector, config);
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { ctx, request };
  // bind guard so tests can call it
  (ctx as any).__guard = guard;
}

function runGuard(headers: Record<string, string>, roles?: string[], isPublic?: boolean) {
  const request: Record<string, unknown> = { headers };
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => {
      if (key === 'isPublic') return isPublic ?? false;
      if (key === 'roles') return roles;
      return undefined;
    }),
  } as unknown as Reflector;
  const config = {
    get: jest.fn((key: string) => {
      const map: Record<string, string> = {
        EMPLOYEE_API_KEY: 'emp-key',
        MANAGER_API_KEY:  'mgr-key',
        SYSTEM_API_KEY:   'sys-key',
      };
      return map[key];
    }),
  } as unknown as ConfigService;
  const guard = new ApiKeyGuard(reflector, config);
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { result: () => guard.canActivate(ctx), request };
}

describe('ApiKeyGuard', () => {
  it('passes public endpoints without any key', () => {
    const { result } = runGuard({}, undefined, true);
    expect(result()).toBe(true);
  });

  it('throws 401 when API key is missing', () => {
    const { result } = runGuard({});
    expect(result).toThrow(UnauthorizedException);
  });

  it('throws 401 when API key is invalid', () => {
    const { result } = runGuard({ 'x-api-key': 'bad-key' });
    expect(result).toThrow(UnauthorizedException);
  });

  it('sets role=employee and requesterId for valid employee key', () => {
    const { result, request } = runGuard({ 'x-api-key': 'emp-key', 'x-employee-id': 'emp-123' });
    expect(result()).toBe(true);
    expect(request.role).toBe('employee');
    expect(request.requesterId).toBe('emp-123');
  });

  it('throws 401 when employee key is used without X-Employee-ID', () => {
    const { result } = runGuard({ 'x-api-key': 'emp-key' });
    expect(result).toThrow(UnauthorizedException);
  });

  it('sets role=manager for valid manager key', () => {
    const { result, request } = runGuard({ 'x-api-key': 'mgr-key' }, ['manager']);
    expect(result()).toBe(true);
    expect(request.role).toBe('manager');
  });

  it('sets role=system for valid system key', () => {
    const { result, request } = runGuard({ 'x-api-key': 'sys-key' }, ['system']);
    expect(result()).toBe(true);
    expect(request.role).toBe('system');
  });

  it('throws 403 when role does not match required roles', () => {
    const { result } = runGuard({ 'x-api-key': 'emp-key', 'x-employee-id': 'emp-123' }, ['manager']);
    expect(result).toThrow(ForbiddenException);
  });

  it('passes when no roles are required (any authenticated key)', () => {
    const { result } = runGuard({ 'x-api-key': 'mgr-key' });
    expect(result()).toBe(true);
  });

  it('allows employee key on endpoint accepting employee or manager', () => {
    const { result } = runGuard({ 'x-api-key': 'emp-key', 'x-employee-id': 'emp-123' }, ['employee', 'manager']);
    expect(result()).toBe(true);
  });

  it('allows manager key on endpoint accepting employee or manager', () => {
    const { result } = runGuard({ 'x-api-key': 'mgr-key' }, ['employee', 'manager']);
    expect(result()).toBe(true);
  });
});
