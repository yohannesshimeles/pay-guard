import { CorrectionType } from './dto/financial-operation.dto';

export type CorrectionProps = Readonly<{
  id: string;
  businessId: string;
  branchId: string;
  settlementAccountId: string;
  correctionType: CorrectionType;
  amount: string;
  reason: string;
  actualTransactionAt: Date;
  sourceReconciliationId?: string;
  ledgerEntryId: string;
  runningBalance: string;
  status: 'POSTED';
  createdAt: Date;
}>;

export class CorrectionEntity {
  constructor(private readonly props: CorrectionProps) {}

  toPublicModel() {
    return {
      id: this.props.id,
      businessId: this.props.businessId,
      branchId: this.props.branchId,
      settlementAccountId: this.props.settlementAccountId,
      correctionType: this.props.correctionType,
      currency: 'ETB' as const,
      amount: this.props.amount,
      reason: this.props.reason,
      actualTransactionAt: this.props.actualTransactionAt,
      sourceReconciliationId: this.props.sourceReconciliationId,
      ledgerEntryId: this.props.ledgerEntryId,
      runningBalance: this.props.runningBalance,
      status: this.props.status,
      createdAt: this.props.createdAt,
    };
  }
}
