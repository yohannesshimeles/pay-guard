export type ManualDepositProps = Readonly<{
  id: string;
  businessId: string;
  branchId: string;
  settlementAccountId: string;
  amount: string;
  description: string;
  actualTransactionAt: Date;
  cashierRoleAssignmentId: string;
  ledgerEntryId: string;
  runningBalance: string;
  status: 'POSTED';
  createdAt: Date;
  attachment?: Readonly<{
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: Date;
  }>;
}>;

export class ManualDepositEntity {
  constructor(private readonly props: ManualDepositProps) {}

  toPublicModel() {
    return {
      id: this.props.id,
      businessId: this.props.businessId,
      branchId: this.props.branchId,
      settlementAccountId: this.props.settlementAccountId,
      currency: 'ETB' as const,
      amount: this.props.amount,
      description: this.props.description,
      actualTransactionAt: this.props.actualTransactionAt,
      ledgerEntryId: this.props.ledgerEntryId,
      runningBalance: this.props.runningBalance,
      status: this.props.status,
      createdAt: this.props.createdAt,
      attachment: this.props.attachment,
    };
  }
}
