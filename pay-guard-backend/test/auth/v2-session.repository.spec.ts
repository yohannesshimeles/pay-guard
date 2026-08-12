import { DatabaseService } from '../../src/database/database.service';
import { V2SessionRepository } from '../../src/auth/v2-session.repository';

describe('V2SessionRepository', () => {
  const client = { query: jest.fn() };
  const database = {
    query: jest.fn(),
    transaction: jest.fn((work: (value: typeof client) => unknown) =>
      Promise.resolve(work(client)),
    ),
  };
  const repository = new V2SessionRepository(
    database as unknown as DatabaseService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('validates context before creating a business session', async () => {
    client.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'session-1' }] });

    await expect(
      repository.createBusinessSession({
        userId: '00000000-0000-0000-0000-000000000001',
        membershipId: '00000000-0000-0000-0000-000000000002',
        membershipRoleId: '00000000-0000-0000-0000-000000000003',
        workAssignmentId: '00000000-0000-0000-0000-000000000004',
        refreshTokenHash: 'a'.repeat(64),
        expiresAt: new Date('2026-09-01T00:00:00.000Z'),
        devicePlatform: 'web',
      }),
    ).resolves.toEqual({ sessionId: 'session-1' });

    expect(client.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("membership.status = 'ACTIVE'"),
      expect.arrayContaining([
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
      ]),
    );
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO user_sessions'),
      expect.arrayContaining(['a'.repeat(64)]),
    );
    expect(client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("role_assignment.role_code = 'WAITER'"),
      expect.arrayContaining(['session-1', 'web']),
    );
  });

  it('rejects a stale or forged authorization context', async () => {
    client.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await expect(
      repository.createBusinessSession({
        userId: '00000000-0000-0000-0000-000000000001',
        membershipId: '00000000-0000-0000-0000-000000000002',
        membershipRoleId: '00000000-0000-0000-0000-000000000003',
        refreshTokenHash: 'a'.repeat(64),
        expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      }),
    ).rejects.toThrow('Active authorization context not found');
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('finds an active platform administrator session after checking user sessions', async () => {
    database.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'admin-session-1',
            platform_admin_id: 'admin-1',
            expires_at: new Date('2026-09-01T00:00:00.000Z'),
            revoked_at: null,
          },
        ],
      });

    await expect(
      repository.findActiveByRefreshTokenHash('b'.repeat(64)),
    ).resolves.toMatchObject({
      id: 'admin-session-1',
      sessionKind: 'PLATFORM_ADMIN',
      subjectId: 'admin-1',
    });
    expect(database.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM platform_admin_sessions'),
      ['b'.repeat(64)],
    );
  });

  it('rotates a refresh token only when the current token is still active', async () => {
    database.query.mockResolvedValueOnce({ rowCount: 1 });

    await expect(
      repository.rotateRefreshToken({
        sessionKind: 'BUSINESS_USER',
        sessionId: 'session-1',
        currentHash: 'a'.repeat(64),
        nextHash: 'b'.repeat(64),
        nextExpiry: new Date('2026-09-01T00:00:00.000Z'),
      }),
    ).resolves.toBe(true);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE user_sessions'),
      expect.arrayContaining(['a'.repeat(64), 'b'.repeat(64)]),
    );
  });

  it('checks active membership context on every business request', async () => {
    database.query.mockResolvedValueOnce({ rowCount: 1 });

    await expect(
      repository.isActive({
        sessionKind: 'BUSINESS_USER',
        sessionId: 'session-1',
        subjectId: 'user-1',
      }),
    ).resolves.toBe(true);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("business.status = 'ACTIVE'"),
      ['session-1', 'user-1'],
    );
  });
});
