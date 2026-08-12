import { ForbiddenException } from '@nestjs/common';
import { V2ContextSelectorService } from '../../src/auth/v2-context-selector.service';
import { V2AuthIdentity } from '../../src/auth/v2-auth.types';

describe('V2ContextSelectorService', () => {
  const selector = new V2ContextSelectorService();
  const businessIdentity: V2AuthIdentity = {
    id: 'user-1',
    identityType: 'BUSINESS_USER',
    passwordHash: 'hash',
    status: 'ACTIVE',
    contexts: [
      {
        membershipId: 'membership-1',
        membershipRoleId: 'role-1',
        role: 'MANAGER',
        businessId: 'business-1',
        workAssignmentId: 'assignment-1',
        workScope: 'BRANCH',
        branchId: 'branch-1',
      },
      {
        membershipId: 'membership-1',
        membershipRoleId: 'role-2',
        role: 'PRIMARY_OWNER',
        businessId: 'business-1',
      },
    ],
  };

  it('selects the platform context without exposing business identifiers', () => {
    expect(
      selector.select({
        id: 'admin-1',
        identityType: 'PLATFORM_ADMIN',
        passwordHash: 'hash',
        status: 'ACTIVE',
        contexts: [],
      }),
    ).toEqual({
      status: 'SELECTED',
      context: {
        identityType: 'PLATFORM_ADMIN',
        subjectId: 'admin-1',
        role: 'PLATFORM_SUPER_ADMIN',
      },
    });
  });

  it('requires an explicit choice when multiple contexts are active', () => {
    const result = selector.select(businessIdentity);

    expect(result.status).toBe('SELECTION_REQUIRED');
    if (result.status === 'SELECTION_REQUIRED') {
      expect(result.contexts).toHaveLength(2);
    }
  });

  it('selects only an exact active membership, role and work assignment', () => {
    const result = selector.select(businessIdentity, {
      membershipId: 'membership-1',
      membershipRoleId: 'role-1',
      workAssignmentId: 'assignment-1',
    });

    expect(result.status).toBe('SELECTED');
    if (result.status === 'SELECTED') {
      expect(result.context).toMatchObject({
        subjectId: 'user-1',
        role: 'MANAGER',
        branchId: 'branch-1',
      });
    }
  });

  it('rejects a stale, partial or forged selection', () => {
    expect(() =>
      selector.select(businessIdentity, {
        membershipId: 'membership-1',
        membershipRoleId: 'role-1',
      }),
    ).toThrow(ForbiddenException);
  });

  it('automatically selects the only active business context', () => {
    const result = selector.select({
      ...businessIdentity,
      contexts: [businessIdentity.contexts[1]],
    });

    expect(result.status).toBe('SELECTED');
    if (result.status === 'SELECTED') {
      expect(result.context.role).toBe('PRIMARY_OWNER');
    }
  });

  it('rejects business identities without an active context', () => {
    expect(() =>
      selector.select({ ...businessIdentity, contexts: [] }),
    ).toThrow(ForbiddenException);
  });
});
