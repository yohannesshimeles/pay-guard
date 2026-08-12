export type CreditLotStatus = 'ACTIVE' | 'EXHAUSTED' | 'EXPIRED';

export type CreditLotProps = Readonly<{
  id: string;
  subscriptionId?: string;
  allocatedCredits: number;
  usedCredits: number;
  expiredCredits: number;
  remainingCredits: number;
  startsAt: Date;
  expiresAt: Date;
  status: CreditLotStatus;
  createdAt: Date;
}>;

export class CreditLotEntity {
  constructor(private readonly props: CreditLotProps) {}

  toPublicModel() {
    return { ...this.props };
  }
}
