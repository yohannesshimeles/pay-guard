import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from './auth.guard';
import { REQUIRED_ROLES } from './roles.decorator';
import { AuthorizationRoleCode } from './auth.types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AuthorizationRoleCode[]>(
      REQUIRED_ROLES,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!this.hasRequiredRole(required, request.user.role)) {
      throw new ForbiddenException('You do not have permission for this action');
    }
    return true;
  }

  private hasRequiredRole(
    required: AuthorizationRoleCode[],
    actual: AuthorizationRoleCode,
  ): boolean {
    if (required.includes(actual)) return true;
    return (
      required.includes('BUSINESS_OWNER') &&
      (actual === 'PRIMARY_OWNER' || actual === 'ADDITIONAL_OWNER')
    );
  }
}
