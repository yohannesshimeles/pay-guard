export const V2_ROLES = [
  'PLATFORM_SUPER_ADMIN',
  'PRIMARY_OWNER',
  'ADDITIONAL_OWNER',
  'MANAGER',
  'CASHIER',
  'WAITER',
] as const;

export type V2RoleCode = (typeof V2_ROLES)[number];

export type V2WorkScope = 'MAIN_BUSINESS' | 'BRANCH';

export type V2AuthorizationContext = {
  membershipId: string;
  membershipRoleId: string;
  role: Exclude<V2RoleCode, 'PLATFORM_SUPER_ADMIN'>;
  businessId: string;
  workAssignmentId?: string;
  workScope?: V2WorkScope;
  branchId?: string;
};

export type V2ContextSelection = {
  membershipId: string;
  membershipRoleId: string;
  workAssignmentId?: string;
};

export type V2SelectedAuthContext = {
  identityType: 'PLATFORM_ADMIN' | 'BUSINESS_USER';
  subjectId: string;
  role: V2RoleCode;
  businessId?: string;
  membershipId?: string;
  membershipRoleId?: string;
  workAssignmentId?: string;
  workScope?: V2WorkScope;
  branchId?: string;
};

export type V2ContextSelectionResult =
  | { status: 'SELECTED'; context: V2SelectedAuthContext }
  | { status: 'SELECTION_REQUIRED'; contexts: V2AuthorizationContext[] };

export type V2AuthIdentity = {
  id: string;
  identityType: 'PLATFORM_ADMIN' | 'BUSINESS_USER';
  passwordHash: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
  contexts: V2AuthorizationContext[];
};
