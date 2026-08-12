import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CentralDao } from '../database/central.dao';

type TransactionScopeRow = {
  business_id: string;
  branch_id: string | null;
  submitted_by_user_id: string;
  transaction_reference: string;
  amount: string;
  transaction_date: string;
  transaction_time: string;
  verifyet_bank_identifier: string;
  normalized_account_suffix: string | null;
};

export type TransactionReceiptScope = Readonly<{
  businessId: string;
  branchId: string;
  submittedByUserId: string;
  transactionReference: string;
  amount: string;
  transactionDate: string;
  transactionTime: string;
  bankIdentifier: string;
  accountSuffix?: string;
}>;

@Injectable()
export class TransactionReceiptAccessDao {
  constructor(private readonly dao: CentralDao) {}

  async assertCanUpload(
    transactionId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<TransactionReceiptScope> {
    const transaction = await this.dao.optional<TransactionScopeRow>(
      `SELECT transaction.business_id, transaction.branch_id,
              transaction.submitted_by_user_id,
              transaction.transaction_reference, transaction.amount::text,
              transaction.transaction_date::text,
              transaction.transaction_time::text,
              bank.verifyet_bank_identifier,
              account.normalized_account_suffix
         FROM customer_transactions transaction
         JOIN supported_banks bank ON bank.id = transaction.bank_id
         JOIN settlement_accounts account
           ON account.id = transaction.settlement_account_id
        WHERE transaction.id = $1`,
      [transactionId],
    );
    if (!transaction) throw new NotFoundException('Transaction was not found');

    const sameBusiness = principal.businessIds.includes(transaction.business_id);
    const sameBranch =
      !principal.branchId || principal.branchId === transaction.branch_id;
    const ownsWaiterTransaction =
      principal.role !== 'WAITER' ||
      principal.userId === transaction.submitted_by_user_id;

    if (!sameBusiness || !sameBranch || !ownsWaiterTransaction) {
      throw new ForbiddenException(
        'You do not have permission to upload proof for this transaction',
      );
    }
    if (!transaction.branch_id) {
      throw new ForbiddenException(
        'Transaction receipt verification requires a branch transaction',
      );
    }
    return {
      businessId: transaction.business_id,
      branchId: transaction.branch_id,
      submittedByUserId: transaction.submitted_by_user_id,
      transactionReference: transaction.transaction_reference,
      amount: transaction.amount,
      transactionDate: transaction.transaction_date,
      transactionTime: transaction.transaction_time,
      bankIdentifier: transaction.verifyet_bank_identifier,
      accountSuffix: transaction.normalized_account_suffix ?? undefined,
    };
  }
}
