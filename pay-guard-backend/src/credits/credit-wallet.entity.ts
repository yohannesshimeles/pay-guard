export type CreditWalletProps = Readonly<{
  businessId: string;
  branchId: string;
  purchasedCredits: number;
  usedCredits: number;
  expiredCredits: number;
  availableCredits: number;
  activeSubscriptionId?: string;
  updatedAt: Date;
}>;

export class CreditWalletEntity {
  constructor(private readonly props: CreditWalletProps) {}

  toPublicModel() {
    return { ...this.props };
  }
}
