export type ReconciliationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'MATCHED'
  | 'DISCREPANCY'
  | 'APPROVED'
  | 'RETURNED'
  | 'SUPERSEDED'
  | 'ARCHIVED';

export type ReconciliationProps = Readonly<{
  id: string;
  businessId: string;
  branchId: string;
  settlementAccountId: string;
  reconciliationDate: string;
  closingTime: string;
  openingBalance: string;
  verifiedDepositsTotal: string;
  manualDepositsTotal: string;
  withdrawalsTotal: string;
  positiveCorrectionsTotal: string;
  negativeCorrectionsTotal: string;
  reversalsNetTotal: string;
  calculatedBalance: string;
  actualBankBalance: string;
  difference: string;
  description: string;
  differenceExplanation?: string;
  status: ReconciliationStatus;
  sequenceNo: number;
  submittedAt?: Date;
  decisionReason?: string;
  decidedAt?: Date;
  createdAt: Date;
}>;

export class ReconciliationEntity {
  constructor(private readonly props: ReconciliationProps) {}

  toPublicModel() {
    return {
      id: this.props.id,
      businessId: this.props.businessId,
      branchId: this.props.branchId,
      settlementAccountId: this.props.settlementAccountId,
      reconciliationDate: this.props.reconciliationDate,
      closingTime: this.props.closingTime,
      currency: 'ETB' as const,
      totals: {
        openingBalance: this.props.openingBalance,
        verifiedDeposits: this.props.verifiedDepositsTotal,
        manualDeposits: this.props.manualDepositsTotal,
        withdrawals: this.props.withdrawalsTotal,
        positiveCorrections: this.props.positiveCorrectionsTotal,
        negativeCorrections: this.props.negativeCorrectionsTotal,
        reversalsNet: this.props.reversalsNetTotal,
      },
      calculatedBalance: this.props.calculatedBalance,
      actualBankBalance: this.props.actualBankBalance,
      difference: this.props.difference,
      description: this.props.description,
      differenceExplanation: this.props.differenceExplanation,
      status: this.props.status,
      sequenceNo: this.props.sequenceNo,
      submittedAt: this.props.submittedAt,
      decisionReason: this.props.decisionReason,
      decidedAt: this.props.decidedAt,
      createdAt: this.props.createdAt,
    };
  }
}
