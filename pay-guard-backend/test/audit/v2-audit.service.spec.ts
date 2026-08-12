import { V2AuditService } from '../../src/audit/v2-audit.service';
import { DatabaseService } from '../../src/database/database.service';

describe('V2AuditService', () => {
  const database = { query: jest.fn() };
  const service = new V2AuditService(database as unknown as DatabaseService);

  beforeEach(() => {
    jest.clearAllMocks();
    database.query.mockResolvedValue({ rowCount: 1 });
  });

  it('stores a business actor and user session without an admin identity', async () => {
    await service.record({
      actor: {
        identityType: 'BUSINESS_USER',
        subjectId: 'user-1',
        role: 'MANAGER',
        businessId: 'business-1',
        membershipId: 'membership-1',
      },
      sessionId: 'session-1',
      actionType: 'AUTH_LOGIN',
      recordType: 'SESSION',
    });

    expect(database.query).toHaveBeenCalledWith(expect.any(String), [
      'user-1',
      null,
      'membership-1',
      'MANAGER',
      'business-1',
      null,
      'AUTH_LOGIN',
      'SESSION',
      null,
      null,
      null,
      null,
      'session-1',
      null,
      'SUCCESS',
      null,
    ]);
  });

  it('stores a Platform Super Admin and admin session without a user identity', async () => {
    await service.record({
      actor: {
        identityType: 'PLATFORM_ADMIN',
        subjectId: 'admin-1',
        role: 'PLATFORM_SUPER_ADMIN',
      },
      sessionId: 'admin-session-1',
      actionType: 'AUTH_LOGOUT',
      recordType: 'SESSION',
    });

    expect(database.query).toHaveBeenCalledWith(expect.any(String), [
      null,
      'admin-1',
      null,
      'PLATFORM_SUPER_ADMIN',
      null,
      null,
      'AUTH_LOGOUT',
      'SESSION',
      null,
      null,
      null,
      null,
      null,
      'admin-session-1',
      'SUCCESS',
      null,
    ]);
  });
});
