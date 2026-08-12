import { SetMetadata } from '@nestjs/common';
import { AuthorizationRoleCode } from './auth.types';

export const REQUIRED_ROLES = 'requiredRoles';
export const Roles = (...roles: AuthorizationRoleCode[]) =>
  SetMetadata(REQUIRED_ROLES, roles);
