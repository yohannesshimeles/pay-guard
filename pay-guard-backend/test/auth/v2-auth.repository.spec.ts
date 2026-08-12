import { DatabaseService } from '../../src/database/database.service';
import { V2AuthRepository } from '../../src/auth/v2-auth.repository';

describe('V2AuthRepository', () => {
  const database = { query: jest.fn() };
  const repository = new V2AuthRepository(
    database as unknown as DatabaseService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('resolves a platform administrator without a business context', async () => {
    database.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'admin-1',
          password_hash: 'hash',
          status: 'ACTIVE',
        },
      ],
    });

    await expect(repository.findIdentity(' Admin@Example.test ')).resolves.toEqual({
      id: 'admin-1',
      identityType: 'PLATFORM_ADMIN',
      passwordHash: 'hash',
      status: 'ACTIVE',
      contexts: [],
    });
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM platform_admin'),
      ['Admin@Example.test'],
    );
  });

  it('maps all active membership, role and work contexts for a user', async () => {
    database.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'user-1',
            password_hash: 'hash',
            global_status: 'ACTIVE',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            membership_id: 'membership-1',
            membership_role_id: 'role-1',
            role_code: 'MANAGER',
            business_id: 'business-1',
            work_assignment_id: 'assignment-1',
            assignment_type: 'BRANCH',
            branch_id: 'branch-1',
          },
          {
            membership_id: 'membership-1',
            membership_role_id: 'role-2',
            role_code: 'BUSINESS_OWNER',
            business_id: 'business-1',
            work_assignment_id: null,
            assignment_type: null,
            branch_id: null,
          },
        ],
      });

    const identity = await repository.findIdentity('user@example.test');

    expect(identity).toEqual({
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
          role: 'BUSINESS_OWNER',
          businessId: 'business-1',
          workAssignmentId: undefined,
          workScope: undefined,
          branchId: undefined,
        },
      ],
    });
    expect(database.query).toHaveBeenLastCalledWith(
      expect.stringContaining("membership.status = 'ACTIVE'"),
      ['user-1'],
    );
  });

  it('returns undefined when neither identity store has a match', async () => {
    database.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(repository.findIdentity('missing@example.test')).resolves.toBeUndefined();
  });
});
