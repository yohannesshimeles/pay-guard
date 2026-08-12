export type V2SessionKind = 'BUSINESS_USER' | 'PLATFORM_ADMIN';

export type V2Session = {
  id: string;
  sessionKind: V2SessionKind;
  subjectId: string;
  membershipId?: string;
  membershipRoleId?: string;
  workAssignmentId?: string;
  role: V2RoleCode;
  businessId?: string;
  workScope?: V2WorkScope;
  branchId?: string;
  expiresAt: Date;
  revokedAt?: Date;
};

export type V2BusinessSessionInput = {
  userId: string;
  membershipId: string;
  membershipRoleId: string;
  workAssignmentId?: string;
  refreshTokenHash: string;
  expiresAt: Date;
  deviceIdentifierHash?: string;
  devicePlatform?: 'web' | 'android' | 'ios';
};

export type V2PlatformAdminSessionInput = {
  platformAdminId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  deviceIdentifierHash?: string;
  devicePlatform?: 'web' | 'android' | 'ios';
};
import { V2RoleCode, V2WorkScope } from './v2-auth.types';
