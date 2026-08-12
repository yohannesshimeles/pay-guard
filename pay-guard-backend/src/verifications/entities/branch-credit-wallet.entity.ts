export type BranchCreditWalletEntityProps = {
  branchId: string;
  businessId: string;
  purchasedCredits: number;
  usedCredits: number;
  expiredCredits: number;
  availableCredits: number;
  activeSubscriptionId?: string;
  updatedAt: Date;
};

export class BranchCreditWalletEntity {
  readonly branchId: string;
  readonly businessId: string;
  readonly purchasedCredits: number;
  readonly usedCredits: number;
  readonly expiredCredits: number;
  readonly availableCredits: number;
  readonly activeSubscriptionId?: string;
  readonly updatedAt: Date;

  constructor(props: BranchCreditWalletEntityProps) {
    for (const value of [
      props.purchasedCredits,
      props.usedCredits,
      props.expiredCredits,
      props.availableCredits,
    ]) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error('Branch credit wallet contains an invalid balance');
      }
    }
    if (
      props.purchasedCredits !==
      props.usedCredits + props.expiredCredits + props.availableCredits
    ) {
      throw new Error('Branch credit wallet balance invariant is violated');
    }

    this.branchId = props.branchId;
    this.businessId = props.businessId;
    this.purchasedCredits = props.purchasedCredits;
    this.usedCredits = props.usedCredits;
    this.expiredCredits = props.expiredCredits;
    this.availableCredits = props.availableCredits;
    this.activeSubscriptionId = props.activeSubscriptionId;
    this.updatedAt = props.updatedAt;
  }
}
