import { AuthFacadeService } from '../../src/auth/auth-facade.service';
import { AuthService } from '../../src/auth/auth.service';
import { V2AuthService } from '../../src/auth/v2-auth.service';
import { AppConfig } from '../../src/config/app-config';

describe('AuthFacadeService', () => {
  const legacy = {
    login: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
    verifyAccessToken: jest.fn(),
  };
  const v2 = {
    login: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
    verifyAccessToken: jest.fn(),
  };
  const baseConfig = {
    databaseSchemaVersion: 'legacy',
  } as AppConfig;

  beforeEach(() => jest.clearAllMocks());

  it('keeps legacy authentication as the default path', async () => {
    legacy.login.mockResolvedValueOnce({ source: 'legacy' });
    const facade = new AuthFacadeService(
      legacy as unknown as AuthService,
      v2 as unknown as V2AuthService,
      baseConfig,
    );

    await expect(
      facade.login({ identity: 'user@example.test', password: 'password' }),
    ).resolves.toEqual({ source: 'legacy' });
    expect(v2.login).not.toHaveBeenCalled();
  });

  it('routes all authentication operations to V2 only when explicitly enabled', async () => {
    const facade = new AuthFacadeService(
      legacy as unknown as AuthService,
      v2 as unknown as V2AuthService,
      { ...baseConfig, databaseSchemaVersion: 'v2' },
    );
    v2.login.mockResolvedValueOnce({ source: 'v2' });
    v2.refresh.mockResolvedValueOnce({ source: 'v2' });
    v2.logout.mockResolvedValueOnce({ loggedOut: true });
    v2.verifyAccessToken.mockResolvedValueOnce({ userId: 'user-1' });

    await facade.login({ identity: 'user@example.test', password: 'password' });
    await facade.refresh('refresh-token');
    await facade.logout('refresh-token');
    await facade.verifyAccessToken('access-token');

    expect(v2.login).toHaveBeenCalledTimes(1);
    expect(v2.refresh).toHaveBeenCalledTimes(1);
    expect(v2.logout).toHaveBeenCalledTimes(1);
    expect(v2.verifyAccessToken).toHaveBeenCalledTimes(1);
    expect(legacy.login).not.toHaveBeenCalled();
  });
});
