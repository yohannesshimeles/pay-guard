import { LedgerDirection, LedgerEntryType } from './ledger-entry-type.enum';

export type LedgerEntryProps = Readonly<{
  id: string;
  businessId: string;
  branchId?: string;
  settlementAccountId: string;
  entryType: LedgerEntryType;
  direction: LedgerDirection;
  amount: string;
  runningBalance: string;
  actualTransactionAt: Date;
  sourceRecordType: string;
  sourceRecordId: string;
  description?: string;
  createdByUserId?: string;
  workAssignmentId?: string;
  auditLogId?: string;
  reversalOfEntryId?: string;
  idempotencyKey?: string;
  createdAt: Date;
}>;

export class LedgerEntryEntity {
  readonly id: string;
  readonly businessId: string;
  readonly branchId?: string;
  readonly settlementAccountId: string;
  readonly entryType: LedgerEntryType;
  readonly direction: LedgerDirection;
  readonly amount: string;
  readonly runningBalance: string;
  readonly actualTransactionAt: Date;
  readonly sourceRecordType: string;
  readonly sourceRecordId: string;
  readonly description?: string;
  readonly createdByUserId?: string;
  readonly workAssignmentId?: string;
  readonly auditLogId?: string;
  readonly reversalOfEntryId?: string;
  readonly idempotencyKey?: string;
  readonly createdAt: Date;

  constructor(props: LedgerEntryProps) {
    this.id = props.id;
    this.businessId = props.businessId;
    this.branchId = props.branchId;
    this.settlementAccountId = props.settlementAccountId;
    this.entryType = props.entryType;
    this.direction = props.direction;
    this.amount = props.amount;
    this.runningBalance = props.runningBalance;
    this.actualTransactionAt = props.actualTransactionAt;
    this.sourceRecordType = props.sourceRecordType;
    this.sourceRecordId = props.sourceRecordId;
    this.description = props.description;
    this.createdByUserId = props.createdByUserId;
    this.workAssignmentId = props.workAssignmentId;
    this.auditLogId = props.auditLogId;
    this.reversalOfEntryId = props.reversalOfEntryId;
    this.idempotencyKey = props.idempotencyKey;
    this.createdAt = props.createdAt;
  }
}
