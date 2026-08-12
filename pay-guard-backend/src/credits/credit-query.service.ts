import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CreditQueryDao } from './credit-query.dao';
import { ListCreditHistoryDto } from './dto/credit-query.dto';

@Injectable()
export class CreditQueryService {
  constructor(private readonly credits: CreditQueryDao) {}

  async wallet(
    businessId: string,
    branchId: string,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertScope(businessId, branchId, actor);
    const wallet = await this.credits.findWallet(businessId, branchId);
    if (!wallet) throw new NotFoundException('Branch credit wallet not found');
    const lots = await this.credits.listLots(businessId, branchId);
    const alerts = await this.credits.listAlerts(businessId, branchId);
    return {
      wallet: wallet.toPublicModel(),
      lots: lots.map((lot) => lot.toPublicModel()),
      alerts,
    };
  }

  async history(
    businessId: string,
    branchId: string,
    input: ListCreditHistoryDto,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertScope(businessId, branchId, actor);
    return (await this.credits.listHistory(businessId, branchId, input))
      .map((event) => event.toPublicModel());
  }

  private assertScope(
    businessId: string,
    branchId: string,
    actor: AuthenticatedPrincipal,
  ): void {
    if (
      actor.identityType !== 'BUSINESS_USER' ||
      !actor.businessIds.includes(businessId) ||
      !['BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER', 'CASHIER']
        .includes(actor.role) ||
      (['MANAGER', 'CASHIER'].includes(actor.role) && actor.branchId !== branchId)
    ) {
      throw new ForbiddenException('Branch credit access denied');
    }
  }
}
