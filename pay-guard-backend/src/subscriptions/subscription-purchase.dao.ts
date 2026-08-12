import { Injectable } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CentralDao, DaoTransaction } from '../database/central.dao';
import { SubscriptionPurchaseEntity, SubscriptionPurchaseStatus } from './subscription-purchase.entity';

type PurchaseRow = {
  id: string; business_id: string; branch_id: string; plan_id: string;
  plan_name_snapshot: string; credits_snapshot: string; price_snapshot: string;
  duration_days_snapshot: number; purchasing_membership_id: string;
  payment_bank_id: string; payment_bank_name: string; platform_account_id: string;
  masked_account_number: string; status: SubscriptionPurchaseStatus;
  created_at: Date; updated_at: Date; proof_id: string | null;
  proof_file_name: string | null; proof_mime_type: string | null;
  proof_size_bytes: string | null; extraction_state: string | null;
  candidate_count: number | null; parsed_bank_code: string | null;
  parsed_reference: string | null; parsed_amount_etb: string | null;
  parsed_account_suffix: string | null; parsed_transaction_date: string | null;
  parsed_transaction_time: string | null;
  proof_created_at: Date | null;
  invoice_id: string | null; invoice_number: string | null;
  invoice_amount_etb: string | null; invoice_currency: 'ETB' | null;
  invoice_payment_reference: string | null; invoice_issued_at: Date | null;
};

export type CreateSubscriptionPurchase = Readonly<{
  id: string; businessId: string; branchId: string; planId: string;
  paymentBankId: string; actor: AuthenticatedPrincipal;
}>;

export class SubscriptionPurchaseScopeError extends Error {}
export class SubscriptionPurchaseNotFoundError extends Error {}
export class SubscriptionPurchaseReplayConflictError extends Error {}
export class SubscriptionProofConflictError extends Error {}
export class SubscriptionPurchaseLockedError extends Error {}

@Injectable()
export class SubscriptionPurchaseDao {
  constructor(private readonly dao: CentralDao) {}

  listPlans() {
    return this.dao.many<{
      id: string; name: string; credits: string; price_etb: string;
      duration_days: number;
    }>(
      `SELECT id, name, credits::text, price_etb::text, duration_days
       FROM subscription_plans WHERE status = 'ACTIVE'
       ORDER BY price_etb, credits, id`,
    );
  }

  async createWithin(transaction: DaoTransaction, input: CreateSubscriptionPurchase) {
    const existing = await this.findWithin(transaction, input.id, input.businessId, input.branchId);
    if (existing) {
      if (
        existing.props.planId !== input.planId ||
        existing.props.paymentBankId !== input.paymentBankId ||
        existing.props.purchasingMembershipId !== input.actor.membershipId
      ) throw new SubscriptionPurchaseReplayConflictError();
      return { purchase: existing, replayed: true };
    }

    const purchaseLock = await transaction.optional<{ id: string }>(
      `SELECT id FROM subscription_purchase_locks
       WHERE business_id = $1 AND status IN ('ACTIVE','RECOVERY_ISSUED')`,
      [input.businessId],
    );
    if (purchaseLock) throw new SubscriptionPurchaseLockedError();

    const inserted = await transaction.optional<{ id: string }>(
      `INSERT INTO subscription_orders (
         id, idempotency_key, business_id, branch_id, plan_id,
         plan_name_snapshot, credits_snapshot, price_snapshot,
         duration_days_snapshot, purchasing_membership_id,
         payment_bank_id, platform_account_id, status
       )
       SELECT $1,$1,business.id,branch.id,plan.id,plan.name,plan.credits,
              plan.price_etb,plan.duration_days,membership.id,bank.id,account.id,
              'ORDER_CREATED'
       FROM businesses business
       JOIN branches branch ON branch.id = $3 AND branch.business_id = business.id
         AND branch.status = 'ACTIVE'
       JOIN subscription_plans plan ON plan.id = $4 AND plan.status = 'ACTIVE'
       JOIN supported_banks bank ON bank.id = $5 AND bank.status = 'ACTIVE'
       JOIN platform_settlement_accounts account ON account.bank_id = bank.id
         AND account.status = 'ACTIVE'
       JOIN business_user_memberships membership ON membership.id = $6
         AND membership.business_id = business.id AND membership.user_id = $7
         AND membership.status = 'ACTIVE'
       JOIN membership_role_assignments role_assignment
         ON role_assignment.id = $8 AND role_assignment.membership_id = membership.id
         AND role_assignment.role_code IN ('PRIMARY_OWNER','ADDITIONAL_OWNER')
         AND role_assignment.status = 'ACTIVE'
       WHERE business.id = $2 AND business.status = 'ACTIVE'
       RETURNING id`,
      [input.id, input.businessId, input.branchId, input.planId,
       input.paymentBankId, input.actor.membershipId, input.actor.userId,
       input.actor.membershipRoleId],
    );
    if (!inserted) throw new SubscriptionPurchaseScopeError();
    const purchase = await this.findWithin(transaction, input.id, input.businessId, input.branchId);
    if (!purchase) throw new SubscriptionPurchaseNotFoundError();
    return { purchase, replayed: false };
  }

  async list(scope: { businessId: string; branchId: string }, input: {
    status?: string; limit: number; offset: number;
  }) {
    const rows = await this.dao.many<PurchaseRow>(
      `${this.selectSql()} WHERE purchase.business_id = $1 AND purchase.branch_id = $2
       AND ($3::varchar IS NULL OR purchase.status = $3)
       ORDER BY purchase.created_at DESC, purchase.id DESC LIMIT $4 OFFSET $5`,
      [scope.businessId, scope.branchId, input.status ?? null, input.limit, input.offset],
    );
    return rows.map((row) => this.map(row).toPublicModel());
  }

  async find(id: string, businessId: string, branchId: string) {
    const row = await this.dao.optional<PurchaseRow>(
      `${this.selectSql()} WHERE purchase.id = $1
       AND purchase.business_id = $2 AND purchase.branch_id = $3`,
      [id, businessId, branchId],
    );
    return row ? this.map(row) : undefined;
  }

  async addProofWithin(transaction: DaoTransaction, input: {
    purchaseId: string; businessId: string; branchId: string; userId: string;
    objectKey: string; fileName: string; mimeType: string; sizeBytes: number;
    sha256: string; extractionState: string; candidateCount: number;
    qrPayloadSha256?: string; parsedBankCode?: string; parsedReference?: string;
    parsedAmountEtb?: string;
    parsedAccountSuffix?: string; parsedTransactionDate?: string;
    parsedTransactionTime?: string;
  }) {
    const purchase = await transaction.optional<{ id: string; status: string }>(
      `SELECT id, status FROM subscription_orders WHERE id = $1
       AND business_id = $2 AND branch_id = $3 FOR UPDATE`,
      [input.purchaseId, input.businessId, input.branchId],
    );
    if (!purchase) throw new SubscriptionPurchaseNotFoundError();
    if (purchase.status !== 'ORDER_CREATED') throw new SubscriptionProofConflictError();
    try {
      await transaction.one<{ id: string }>(
        `INSERT INTO subscription_purchase_proofs (
           order_id, object_key, file_name, mime_type, size_bytes, sha256,
           extraction_state, candidate_count, qr_payload_sha256,
           parsed_bank_code, parsed_reference, parsed_amount_etb,
           parsed_account_suffix, parsed_transaction_date,
           parsed_transaction_time, uploaded_by_user_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id`,
        [input.purchaseId, input.objectKey, input.fileName, input.mimeType,
         input.sizeBytes, input.sha256, input.extractionState, input.candidateCount,
         input.qrPayloadSha256 ?? null, input.parsedBankCode ?? null,
         input.parsedReference ?? null, input.parsedAmountEtb ?? null,
         input.parsedAccountSuffix ?? null, input.parsedTransactionDate ?? null,
         input.parsedTransactionTime ?? null, input.userId],
      );
      await transaction.execute(
        `UPDATE subscription_orders SET status = 'PROOF_RECEIVED' WHERE id = $1`,
        [input.purchaseId],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new SubscriptionProofConflictError();
      }
      throw error;
    }
    const found = await this.findWithin(transaction, input.purchaseId, input.businessId, input.branchId);
    if (!found) throw new SubscriptionPurchaseNotFoundError();
    return found;
  }

  private async findWithin(transaction: DaoTransaction, id: string, businessId: string, branchId: string) {
    const row = await transaction.optional<PurchaseRow>(
      `${this.selectSql()} WHERE purchase.id = $1
       AND purchase.business_id = $2 AND purchase.branch_id = $3`,
      [id, businessId, branchId],
    );
    return row ? this.map(row) : undefined;
  }

  private selectSql() {
    return `SELECT purchase.*, bank.official_name AS payment_bank_name,
      account.masked_account_number, proof.id AS proof_id,
      proof.file_name AS proof_file_name, proof.mime_type AS proof_mime_type,
      proof.size_bytes::text AS proof_size_bytes, proof.extraction_state,
      proof.candidate_count, proof.parsed_bank_code, proof.parsed_reference,
      proof.parsed_amount_etb::text, proof.parsed_account_suffix,
      proof.parsed_transaction_date::text, proof.parsed_transaction_time::text,
      proof.created_at AS proof_created_at, invoice.id AS invoice_id,
      invoice.invoice_number, invoice.amount_etb::text AS invoice_amount_etb,
      invoice.currency AS invoice_currency,
      invoice.payment_reference AS invoice_payment_reference,
      invoice.issued_at AS invoice_issued_at
      FROM subscription_orders purchase
      JOIN supported_banks bank ON bank.id = purchase.payment_bank_id
      JOIN platform_settlement_accounts account ON account.id = purchase.platform_account_id
      LEFT JOIN subscription_purchase_proofs proof ON proof.order_id = purchase.id
      LEFT JOIN subscription_invoices invoice ON invoice.order_id = purchase.id`;
  }

  private map(row: PurchaseRow) {
    return new SubscriptionPurchaseEntity({
      id: row.id, businessId: row.business_id, branchId: row.branch_id,
      planId: row.plan_id, planName: row.plan_name_snapshot,
      credits: row.credits_snapshot, priceEtb: row.price_snapshot,
      durationDays: row.duration_days_snapshot,
      purchasingMembershipId: row.purchasing_membership_id,
      paymentBankId: row.payment_bank_id, paymentBankName: row.payment_bank_name,
      platformAccountId: row.platform_account_id,
      platformAccountMask: row.masked_account_number, status: row.status,
      createdAt: row.created_at, updatedAt: row.updated_at,
      ...(row.proof_id ? { proof: {
        id: row.proof_id, fileName: row.proof_file_name!, mimeType: row.proof_mime_type!,
        sizeBytes: row.proof_size_bytes!, extractionState: row.extraction_state!,
        candidateCount: row.candidate_count!,
        ...(row.parsed_bank_code ? { parsedBankCode: row.parsed_bank_code } : {}),
        ...(row.parsed_reference ? { parsedReference: row.parsed_reference } : {}),
        ...(row.parsed_amount_etb ? { parsedAmountEtb: row.parsed_amount_etb } : {}),
        createdAt: row.proof_created_at!,
      }} : {}),
      ...(row.invoice_id ? { invoice: {
        id: row.invoice_id, invoiceNumber: row.invoice_number!,
        amountEtb: row.invoice_amount_etb!, currency: row.invoice_currency!,
        paymentReference: row.invoice_payment_reference!,
        issuedAt: row.invoice_issued_at!,
      }} : {}),
    });
  }
}
