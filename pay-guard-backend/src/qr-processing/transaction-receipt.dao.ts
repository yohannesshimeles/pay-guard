import { Injectable } from '@nestjs/common';
import { CentralDao, DaoTransaction } from '../database/central.dao';
import { TransactionReceiptEntity } from './entities/transaction-receipt.entity';
import { ProofMimeType } from './enums/proof-mime-type.enum';
import { StoredProofModel } from './models/proof-file.model';
import { V2SelectedAuthContext } from '../auth/v2-auth.types';
import { V2AuditService } from '../audit/v2-audit.service';

type TransactionReceiptRow = {
  id: string;
  transaction_id: string;
  storage_object_key: string;
  file_name: string;
  mime_type: ProofMimeType;
  file_size_bytes: string;
  file_hash: string;
  submitted_by_user_id: string;
  created_at: Date;
  archived_at: Date | null;
};

export type CreateTransactionReceipt = {
  transactionId: string;
  submittedByUserId: string;
  proof: StoredProofModel;
  audit?: {
    actor: V2SelectedAuthContext;
    sessionId: string;
    businessId: string;
    branchId: string;
  };
};

@Injectable()
export class TransactionReceiptDao {
  constructor(
    private readonly dao: CentralDao,
    private readonly audit: V2AuditService,
  ) {}

  async create(
    input: CreateTransactionReceipt,
    transaction?: DaoTransaction,
  ): Promise<TransactionReceiptEntity> {
    if (!transaction) {
      return this.dao.transaction((boundary) => this.create(input, boundary));
    }
    const executor = transaction;
    const row = await executor.one<TransactionReceiptRow>(
      `INSERT INTO transaction_receipts (
         transaction_id, storage_object_key, file_name, mime_type,
         file_size_bytes, file_hash, submitted_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        input.transactionId,
        input.proof.objectKey,
        input.proof.fileName,
        input.proof.mimeType,
        input.proof.sizeBytes,
        input.proof.sha256,
        input.submittedByUserId,
      ],
    );
    if (input.audit) {
      await this.audit.recordWithin(transaction, {
        actor: input.audit.actor,
        sessionId: input.audit.sessionId,
        actionType: 'TRANSACTION_PROOF_UPLOADED',
        recordType: 'TRANSACTION_RECEIPT',
        recordId: row.id,
        businessId: input.audit.businessId,
        branchId: input.audit.branchId,
        newValue: {
          transactionId: input.transactionId,
          mimeType: input.proof.mimeType,
          sizeBytes: input.proof.sizeBytes,
          sha256: input.proof.sha256,
        },
      });
    }
    return this.map(row);
  }

  async findById(id: string): Promise<TransactionReceiptEntity | undefined> {
    const row = await this.dao.optional<TransactionReceiptRow>(
      `SELECT * FROM transaction_receipts WHERE id = $1`,
      [id],
    );
    return row ? this.map(row) : undefined;
  }

  async listByTransactionId(
    transactionId: string,
  ): Promise<TransactionReceiptEntity[]> {
    const rows = await this.dao.many<TransactionReceiptRow>(
      `SELECT * FROM transaction_receipts
       WHERE transaction_id = $1
         AND archived_at IS NULL
       ORDER BY created_at, id`,
      [transactionId],
    );
    return rows.map((row) => this.map(row));
  }

  async listArchiveEligible(
    referenceTime: Date,
    limit = 100,
  ): Promise<TransactionReceiptEntity[]> {
    if (Number.isNaN(referenceTime.getTime())) {
      throw new Error('Archive reference time must be valid');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error('Archive eligibility limit must be between 1 and 500');
    }
    const rows = await this.dao.many<TransactionReceiptRow>(
      `SELECT * FROM transaction_receipts
       WHERE archived_at IS NULL
         AND created_at < $1::timestamptz - interval '1 year'
       ORDER BY created_at, id
       LIMIT $2`,
      [referenceTime, limit],
    );
    return rows.map((row) => this.map(row));
  }

  private map(row: TransactionReceiptRow): TransactionReceiptEntity {
    return new TransactionReceiptEntity({
      id: row.id,
      transactionId: row.transaction_id,
      storageObjectKey: row.storage_object_key,
      fileName: row.file_name,
      mimeType: row.mime_type,
      fileSizeBytes: Number(row.file_size_bytes),
      fileHash: row.file_hash,
      submittedByUserId: row.submitted_by_user_id,
      createdAt: row.created_at,
      archivedAt: row.archived_at ?? undefined,
    });
  }
}
