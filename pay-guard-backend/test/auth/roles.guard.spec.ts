import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../src/auth/roles.guard';

function contextWithRole(role: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { role } }),
    }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows a role listed by route metadata', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['MANAGER']),
    } as unknown as Reflector;

    expect(new RolesGuard(reflector).canActivate(contextWithRole('MANAGER'))).toBe(
      true,
    );
  });

  it('rejects a role outside route metadata', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['MANAGER']),
    } as unknown as Reflector;

    expect(() =>
      new RolesGuard(reflector).canActivate(contextWithRole('CASHIER')),
    ).toThrow(ForbiddenException);
  });

  it.each(['PRIMARY_OWNER', 'ADDITIONAL_OWNER'])(
    'allows V2 owner role %s on a legacy owner-protected route',
    (role) => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue(['BUSINESS_OWNER']),
      } as unknown as Reflector;

      expect(new RolesGuard(reflector).canActivate(contextWithRole(role))).toBe(
        true,
      );
    },
  );
});
