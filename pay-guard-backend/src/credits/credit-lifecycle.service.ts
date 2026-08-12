import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CentralDao } from '../database/central.dao';
import {
  CreditGrantReplayConflictError,
  CreditGrantScopeError,
  CreditDeferralBalanceError,
  CreditDeferralReplayConflictError,
  CreditDeferralScopeError,
  CreditLifecycleDao,
  DeferSubscriptionVerification,
  GrantSubscriptionCredits,
} from './credit-lifecycle.dao';

@Injectable()
export class CreditLifecycleService {
  constructor(
    private readonly centralDao: CentralDao,
    private readonly lifecycle: CreditLifecycleDao,
  ) {}

  async deferSubscriptionVerification(input: DeferSubscriptionVerification) {
    try {
      return await this.centralDao.transaction((transaction) =>
        this.lifecycle.deferSubscriptionWithin(transaction, input),
      );
    } catch (error) {
      if (error instanceof CreditDeferralScopeError) {
        throw new NotFoundException('Eligible branch subscription order not found');
      }
      if (error instanceof CreditDeferralBalanceError) {
        throw new ConflictException(
          'Deferred subscription verification requires a zero-credit branch wallet',
        );
      }
      if (error instanceof CreditDeferralReplayConflictError) {
        throw new ConflictException('Deferred subscription verification replay conflict');
      }
      throw error;
    }
  }

  async grantSubscription(input: GrantSubscriptionCredits) {
    try {
      return await this.centralDao.transaction((transaction) =>
        this.lifecycle.grantWithin(transaction, input),
      );
    } catch (error) {
      if (error instanceof CreditGrantScopeError) {
        throw new NotFoundException('Active branch subscription not found');
      }
      if (error instanceof CreditGrantReplayConflictError) {
        throw new ConflictException('Subscription credit grant replay conflict');
      }
      throw error;
    }
  }

  expireDue(effectiveAt = new Date(), limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new RangeError('Credit expiry limit must be between 1 and 500');
    }
    return this.centralDao.transaction((transaction) =>
      this.lifecycle.expireDueWithin(transaction, effectiveAt, limit),
    );
  }
}
