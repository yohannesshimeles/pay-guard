import { CustomerTransactionStatus } from '../../src/verifications/enums/customer-transaction-status.enum';
import { VerificationTransitionSource } from '../../src/verifications/enums/verification-transition-source.enum';
import {
  InvalidVerificationTransitionError,
  VerificationStateMachineService,
} from '../../src/verifications/verification-state-machine.service';

describe('VerificationStateMachineService', () => {
  const machine = new VerificationStateMachineService();

  it.each([
    [
      CustomerTransactionStatus.PROCESSING,
      CustomerTransactionStatus.PENDING,
      VerificationTransitionSource.VERIFYET,
    ],
    [
      CustomerTransactionStatus.PROCESSING,
      CustomerTransactionStatus.WAITING_CREDITS,
      VerificationTransitionSource.CREDIT_POLICY,
    ],
    [
      CustomerTransactionStatus.WAITING_CREDITS,
      CustomerTransactionStatus.PROCESSING,
      VerificationTransitionSource.SYSTEM,
    ],
    [
      CustomerTransactionStatus.PENDING,
      CustomerTransactionStatus.VERIFIED,
      VerificationTransitionSource.VERIFYET,
    ],
    [
      CustomerTransactionStatus.PENDING,
      CustomerTransactionStatus.PAUSED_BRANCH,
      VerificationTransitionSource.SYSTEM,
    ],
  ])('allows %s -> %s by %s', (from, to, source) => {
    expect(() => machine.assertTransition(from, to, source)).not.toThrow();
  });

  it.each([
    [
      CustomerTransactionStatus.PROCESSING,
      CustomerTransactionStatus.PROCESSING,
      VerificationTransitionSource.SYSTEM,
    ],
    [
      CustomerTransactionStatus.VERIFIED,
      CustomerTransactionStatus.PROCESSING,
      VerificationTransitionSource.SYSTEM,
    ],
    [
      CustomerTransactionStatus.FAILED,
      CustomerTransactionStatus.VERIFIED,
      VerificationTransitionSource.VERIFYET,
    ],
    [
      CustomerTransactionStatus.PENDING,
      CustomerTransactionStatus.VERIFIED,
      VerificationTransitionSource.CREDIT_POLICY,
    ],
    [
      CustomerTransactionStatus.PROCESSING,
      CustomerTransactionStatus.WAITING_CREDITS,
      VerificationTransitionSource.VERIFYET,
    ],
  ])('rejects %s -> %s by %s', (from, to, source) => {
    expect(() => machine.assertTransition(from, to, source)).toThrow(
      InvalidVerificationTransitionError,
    );
  });

  it('does not expose a user-controlled source capable of approving pending funds', () => {
    expect(() =>
      machine.assertTransition(
        CustomerTransactionStatus.PENDING,
        CustomerTransactionStatus.VERIFIED,
        'USER' as VerificationTransitionSource,
      ),
    ).toThrow(InvalidVerificationTransitionError);
  });

  it('identifies exactly the immutable final states', () => {
    expect(
      Object.values(CustomerTransactionStatus).filter((status) =>
        machine.isFinal(status),
      ),
    ).toEqual([
      CustomerTransactionStatus.VERIFIED,
      CustomerTransactionStatus.FAILED,
      CustomerTransactionStatus.DUPLICATE,
    ]);
  });
});
