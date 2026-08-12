import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import {
  FraudReviewDao, FraudReviewNotFoundError,
} from '../../src/fraud/fraud-review.dao';
import { FraudReviewService } from '../../src/fraud/fraud-review.service';

describe('FraudReviewService', () => {
  const list = jest.fn();
  const requireReview = jest.fn();
  const service = new FraudReviewService({
    list, require: requireReview,
  } as unknown as FraudReviewDao);
  const admin: AuthenticatedPrincipal = {
    userId: 'admin-id', sessionId: 'admin-session',
    role: 'PLATFORM_SUPER_ADMIN', businessIds: [],
    identityType: 'PLATFORM_ADMIN',
  };

  beforeEach(() => jest.clearAllMocks());

  it('allows only the separate Platform Super Admin identity', () => {
    expect(() => service.list({ limit: 50, offset: 0 }, {
      ...admin, identityType: 'BUSINESS_USER',
    })).toThrow(ForbiddenException);
    expect(list).not.toHaveBeenCalled();
  });

  it('passes validated review filters to the DAO', async () => {
    list.mockResolvedValue([]);
    await expect(service.list({ status: 'OPEN', severity: 'CRITICAL',
      businessId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', limit: 20, offset: 5,
    }, admin)).resolves.toEqual([]);
    expect(list).toHaveBeenCalledWith({
      status: 'OPEN', severity: 'CRITICAL',
      businessId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', limit: 20, offset: 5,
    });
  });

  it('maps an unknown review to not found', async () => {
    requireReview.mockRejectedValue(new FraudReviewNotFoundError());
    await expect(service.require('review-id', admin))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
