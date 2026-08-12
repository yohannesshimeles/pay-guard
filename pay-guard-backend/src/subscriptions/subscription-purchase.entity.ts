export type SubscriptionPurchaseStatus =
  | 'ORDER_CREATED' | 'PROOF_RECEIVED' | 'VERIFICATION_PENDING'
  | 'VERIFIED' | 'FAILED' | 'DUPLICATE' | 'CANCELLED';

export type SubscriptionPurchaseProps = Readonly<{
  id: string; businessId: string; branchId: string; planId: string;
  planName: string; credits: string; priceEtb: string; durationDays: number;
  purchasingMembershipId: string; paymentBankId: string; paymentBankName: string;
  platformAccountId: string; platformAccountMask: string;
  status: SubscriptionPurchaseStatus; createdAt: Date; updatedAt: Date;
  proof?: Readonly<{ id: string; fileName: string; mimeType: string;
    sizeBytes: string; extractionState: string; candidateCount: number;
    parsedBankCode?: string; parsedReference?: string; parsedAmountEtb?: string;
    parsedAccountSuffix?: string; parsedTransactionDate?: string;
    parsedTransactionTime?: string;
    createdAt: Date }>;
  invoice?: Readonly<{ id: string; invoiceNumber: string; amountEtb: string;
    currency: 'ETB'; paymentReference: string; issuedAt: Date }>;
}>;

export class SubscriptionPurchaseEntity {
  constructor(readonly props: SubscriptionPurchaseProps) {}

  toPublicModel() {
    return {
      id: this.props.id,
      businessId: this.props.businessId,
      branchId: this.props.branchId,
      plan: {
        id: this.props.planId, name: this.props.planName,
        credits: this.props.credits, priceEtb: this.props.priceEtb,
        durationDays: this.props.durationDays,
      },
      payment: {
        bankId: this.props.paymentBankId, bankName: this.props.paymentBankName,
        platformAccountId: this.props.platformAccountId,
        platformAccountMask: this.props.platformAccountMask,
      },
      purchasingMembershipId: this.props.purchasingMembershipId,
      status: this.props.status,
      proof: this.props.proof,
      invoice: this.props.invoice,
      createdAt: this.props.createdAt,
      updatedAt: this.props.updatedAt,
    };
  }
}
