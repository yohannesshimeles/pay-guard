export const ROLES = [
  'PLATFORM_SUPER_ADMIN',
  'BUSINESS_OWNER',
  'MANAGER',
  'CASHIER',
  'WAITER',
] as const;

export type RoleCode = (typeof ROLES)[number];
export type AuthorizationRoleCode = RoleCode | V2RoleCode;

export type AuthenticatedPrincipal = {
  userId: string;
  sessionId: string;
  role: AuthorizationRoleCode;
  businessIds: string[];
  branchId?: string;
  deviceId?: string;
  identityType?: 'PLATFORM_ADMIN' | 'BUSINESS_USER';
  membershipId?: string;
  membershipRoleId?: string;
  workAssignmentId?: string;
};

export type AuthUser = {
  id: string;
  passwordHash: string;
  status: 'ACTIVE' | 'INACTIVE' | 'REMOVED';
  role: RoleCode;
  businessIds: string[];
  branchId?: string;
};
import { V2RoleCode } from './v2-auth.types';
