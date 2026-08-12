import { createHash } from 'node:crypto';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { V2AuditService } from '../../src/audit/v2-audit.service';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import { QrExtractionState } from '../../src/qr-processing/enums/qr-extraction-state.enum';
import { ProofMimeType } from '../../src/qr-processing/enums/proof-mime-type.enum';
import { ProofIntakeService } from '../../src/qr-processing/proof-intake.service';
import { ObjectStoragePort } from '../../src/storage/object-storage.port';
import {
  SubscriptionPurchaseDao, SubscriptionPurchaseLockedError,
  SubscriptionPurchaseReplayConflictError,
} from '../../src/subscriptions/subscription-purchase.dao';
import { SubscriptionPurchaseEntity } from '../../src/subscriptions/subscription-purchase.entity';
import { SubscriptionPurchaseService } from '../../src/subscriptions/subscription-purchase.service';

describe('SubscriptionPurchaseService', () => {
  const boundary = {} as DaoTransaction;
  const transaction = jest.fn((work: (value: DaoTransaction) => Promise<unknown>) =>
    work(boundary));
  const createWithin = jest.fn();
  const listPlans = jest.fn();
  const list = jest.fn();
  const find = jest.fn();
  const addProofWithin = jest.fn();
  const inspect = jest.fn();
  const putObject = jest.fn();
  const deleteObject = jest.fn();
  const recordWithin = jest.fn();
  const service = new SubscriptionPurchaseService(
    { transaction } as unknown as CentralDao,
    { createWithin, listPlans, list, find, addProofWithin } as unknown as SubscriptionPurchaseDao,
    { inspect } as unknown as ProofIntakeService,
    { putObject, deleteObject } as unknown as ObjectStoragePort,
    { recordWithin } as unknown as V2AuditService,
  );
  const actor: AuthenticatedPrincipal = {
    userId: 'user-id', sessionId: 'session-id', role: 'PRIMARY_OWNER',
    businessIds: ['business-id'], identityType: 'BUSINESS_USER',
    membershipId: 'membership-id', membershipRoleId: 'role-id',
  };
  const input = {
    idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    planId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    paymentBankId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  };
  const purchase = new SubscriptionPurchaseEntity({
    id: input.idempotencyKey, businessId: 'business-id', branchId: 'branch-id',
    planId: input.planId, planName: 'Starter', credits: '10000',
    priceEtb: '8000.00', durationDays: 30, purchasingMembershipId: 'membership-id',
    paymentBankId: input.paymentBankId, paymentBankName: 'Commercial Bank',
    platformAccountId: 'account-id', platformAccountMask: '****9001',
    status: 'ORDER_CREATED', createdAt: new Date('2026-08-09T00:00:00Z'),
    updatedAt: new Date('2026-08-09T00:00:00Z'),
  });

  beforeEach(() => jest.clearAllMocks());

  it('creates an Owner purchase through one transaction with immutable plan snapshot', async () => {
    createWithin.mockResolvedValue({ purchase, replayed: false });
    await expect(service.create('business-id', 'branch-id', input, actor))
      .resolves.toMatchObject({ replayed: false, purchase: {
        plan: { name: 'Starter', credits: '10000', priceEtb: '8000.00' },
        payment: { platformAccountMask: '****9001' },
      }});
    expect(createWithin).toHaveBeenCalledWith(boundary, expect.objectContaining({
      id: input.idempotencyKey, actor,
    }));
    expect(recordWithin).toHaveBeenCalledWith(boundary, expect.objectContaining({
      actionType: 'SUBSCRIPTION_PURCHASE_CREATED',
    }));
  });

  it('rejects non-Owner purchase attempts before database access', async () => {
    await expect(service.create('business-id', 'branch-id', input, {
      ...actor, role: 'MANAGER',
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('maps changed idempotent request content to conflict', async () => {
    createWithin.mockRejectedValue(new SubscriptionPurchaseReplayConflictError());
    await expect(service.create('business-id', 'branch-id', input, actor))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('maps an active fraud lock to a purchase-specific forbidden response', async () => {
    createWithin.mockRejectedValue(new SubscriptionPurchaseLockedError());
    await expect(service.create('business-id', 'branch-id', input, actor))
      .rejects.toMatchObject({ status: 403,
        message: 'Subscription purchasing is locked pending fraud review' });
  });

  it('security-inspects, privately stores and classifies a proof without granting credits', async () => {
    find.mockResolvedValue(purchase);
    const body = Buffer.from('synthetic-png');
    inspect.mockResolvedValue({
      file: { fileName: 'receipt.png', mimeType: ProofMimeType.PNG,
        body, sizeBytes: body.length, sha256: 'a'.repeat(64) },
      extraction: { state: QrExtractionState.SINGLE_QR, candidates: [{
        rawValue: 'secret-raw-qr', parsed: { status: 'COMPLETE', bankCode: 'CBE',
          reference: 'FT123', amountEtb: '8000.00' },
      }]},
    });
    const stored = new SubscriptionPurchaseEntity({
      ...purchase.props, status: 'PROOF_RECEIVED', proof: {
        id: 'proof-id', fileName: 'receipt.png', mimeType: 'image/png',
        sizeBytes: String(body.length), extractionState: 'SINGLE_QR',
        candidateCount: 1, createdAt: new Date('2026-08-09T00:01:00Z'),
      },
    });
    addProofWithin.mockResolvedValue(stored);

    await expect(service.uploadProof('business-id', 'branch-id', purchase.props.id,
      actor, { fileName: 'receipt.png', mimeType: 'image/png', body }))
      .resolves.toMatchObject({ status: 'PROOF_RECEIVED' });
    expect(putObject).toHaveBeenCalledWith(
      expect.stringMatching(/^private\/subscription-purchase-proofs\//u),
      body, 'image/png',
    );
    expect(addProofWithin).toHaveBeenCalledWith(boundary, expect.objectContaining({
      extractionState: 'SINGLE_QR', candidateCount: 1, parsedReference: 'FT123',
      qrPayloadSha256: createHash('sha256').update('secret-raw-qr').digest('hex'),
    }));
  });

  it('blocks a second proof before file inspection or storage', async () => {
    find.mockResolvedValue(new SubscriptionPurchaseEntity({
      ...purchase.props, status: 'PROOF_RECEIVED',
    }));
    await expect(service.uploadProof('business-id', 'branch-id', purchase.props.id,
      actor, { fileName: 'receipt.png', mimeType: 'image/png', body: Buffer.from('x') }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(inspect).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
  });
});
