import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { ListFraudReviewsDto } from './dto/fraud-review.dto';
import { FraudReviewDao, FraudReviewNotFoundError } from './fraud-review.dao';

@Injectable()
export class FraudReviewService {
  constructor(private readonly reviews: FraudReviewDao) {}

  list(input: ListFraudReviewsDto, actor: AuthenticatedPrincipal) {
    this.assertPlatformAdmin(actor);
    return this.reviews.list({
      status: input.status, severity: input.severity,
      businessId: input.businessId, limit: input.limit, offset: input.offset,
    });
  }

  async require(id: string, actor: AuthenticatedPrincipal) {
    this.assertPlatformAdmin(actor);
    try {
      return await this.reviews.require(id);
    } catch (error) {
      if (error instanceof FraudReviewNotFoundError) {
        throw new NotFoundException('Fraud review was not found');
      }
      throw error;
    }
  }

  private assertPlatformAdmin(actor: AuthenticatedPrincipal) {
    if (actor.identityType !== 'PLATFORM_ADMIN' ||
        actor.role !== 'PLATFORM_SUPER_ADMIN') {
      throw new ForbiddenException('Platform Super Admin access required');
    }
  }
}

