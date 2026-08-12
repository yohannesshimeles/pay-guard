import { CreditEventType } from './credit-event-type.enum';

export type CreditEventProps = Readonly<{
  id: string;
  eventType: CreditEventType;
  creditDelta: number;
  balanceBefore: number;
  balanceAfter: number;
  relatedRecordType?: string;
  relatedRecordId?: string;
  reason?: string;
  createdAt: Date;
}>;

export class CreditEventEntity {
  constructor(private readonly props: CreditEventProps) {}

  toPublicModel() {
    return { ...this.props };
  }
}
