export type WithdrawalProps = Readonly<{
  id: string;
  businessId: string;
  branchId: string;
  settlementAccountId: string;
  amount: string;
  recipientName: string;
  recipientBankName: string;
  description: string;
  actualTransactionAt: Date;
  recordedByRoleAssignmentId: string;
  ledgerEntryId: string;
  runningBalance: string;
  status: 'POSTED';
  createdAt: Date;
}>;

export class WithdrawalEntity {
  constructor(private readonly props: WithdrawalProps) {}

  toPublicModel() {
    return {
      id: this.props.id,
      businessId: this.props.businessId,
      branchId: this.props.branchId,
      settlementAccountId: this.props.settlementAccountId,
      currency: 'ETB' as const,
      amount: this.props.amount,
      recipientName: this.props.recipientName,
      recipientBankName: this.props.recipientBankName,
      description: this.props.description,
      actualTransactionAt: this.props.actualTransactionAt,
      ledgerEntryId: this.props.ledgerEntryId,
      runningBalance: this.props.runningBalance,
      status: this.props.status,
      createdAt: this.props.createdAt,
    };
  }
}
