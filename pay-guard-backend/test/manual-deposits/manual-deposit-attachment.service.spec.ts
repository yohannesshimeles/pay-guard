import {
  ConflictException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import { ManualDepositAttachmentService } from '../../src/manual-deposits/manual-deposit-attachment.service';
import { ManualDepositAttachmentConflictError, ManualDepositDao } from '../../src/manual-deposits/manual-deposit.dao';
import { ManualDepositEntity } from '../../src/manual-deposits/manual-deposit.entity';
import { MalwareScanStatus } from '../../src/qr-processing/enums/malware-scan-status.enum';
import { MalwareScannerPort } from '../../src/qr-processing/ports/malware-scanner.port';
import { ProofFileValidator } from '../../src/qr-processing/proof-file.validator';
import { ObjectStoragePort } from '../../src/storage/object-storage.port';

describe('ManualDepositAttachmentService', () => {
  const boundary = {} as DaoTransaction;
  const transaction = jest.fn((work: (value: DaoTransaction) => Promise<unknown>) =>
    work(boundary),
  );
  const scan = jest.fn<
    ReturnType<MalwareScannerPort['scan']>,
    Parameters<MalwareScannerPort['scan']>
  >();
  const putObject = jest.fn<
    ReturnType<ObjectStoragePort['putObject']>,
    Parameters<ObjectStoragePort['putObject']>
  >();
  const deleteObject = jest.fn<
    ReturnType<ObjectStoragePort['deleteObject']>,
    Parameters<ObjectStoragePort['deleteObject']>
  >();
  const attachWithin = jest.fn<
    ReturnType<ManualDepositDao['attachWithin']>,
    Parameters<ManualDepositDao['attachWithin']>
  >();
  const service = new ManualDepositAttachmentService(
    new ProofFileValidator(), { scan },
    { putObject, deleteObject, isReady: jest.fn() },
    { transaction } as unknown as CentralDao,
    { attachWithin } as unknown as ManualDepositDao,
  );
  const actor = {
    userId: 'user-id', sessionId: 'session-id', role: 'CASHIER' as const,
    businessIds: ['business-id'], branchId: 'branch-id',
    identityType: 'BUSINESS_USER' as const, membershipRoleId: 'role-id',
  };
  const file = {
    fileName: 'deposit.pdf', mimeType: 'application/pdf',
    body: Uint8Array.from(Buffer.from('%PDF-1.7')),
  };
  const deposit = new ManualDepositEntity({
    id: 'deposit-id', businessId: 'business-id', branchId: 'branch-id',
    settlementAccountId: 'account-id', amount: '10.00',
    description: 'Cash deposit', actualTransactionAt: new Date(),
    cashierRoleAssignmentId: 'role-id', ledgerEntryId: 'ledger-id',
    runningBalance: '10.00', status: 'POSTED', createdAt: new Date(),
  });

  beforeEach(() => jest.clearAllMocks());

  it('scans, stores under a private key, then persists safe metadata', async () => {
    scan.mockResolvedValue({ status: MalwareScanStatus.CLEAN });
    putObject.mockResolvedValue(undefined);
    attachWithin.mockResolvedValue(deposit);
    await service.upload('business-id', 'branch-id', 'deposit-id', actor, file);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(putObject).toHaveBeenCalledWith(
      expect.stringMatching(/^private\/manual-deposit-attachments\/[0-9a-f-]{36}\.pdf$/u),
      file.body, 'application/pdf',
    );
    expect(attachWithin).toHaveBeenCalledTimes(1);
    const persisted = attachWithin.mock.calls[0][1];
    expect(persisted.depositId).toBe('deposit-id');
    expect(persisted.fileName).toBe('deposit.pdf');
    expect(persisted.sha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('fails closed before storage when malware is detected or unavailable', async () => {
    scan.mockResolvedValueOnce({ status: MalwareScanStatus.INFECTED });
    await expect(service.upload('business-id', 'branch-id', 'deposit-id', actor, file))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
    scan.mockResolvedValueOnce({ status: MalwareScanStatus.ERROR });
    await expect(service.upload('business-id', 'branch-id', 'deposit-id', actor, file))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(putObject).not.toHaveBeenCalled();
  });

  it('deletes storage when database persistence conflicts', async () => {
    scan.mockResolvedValue({ status: MalwareScanStatus.CLEAN });
    putObject.mockResolvedValue(undefined);
    deleteObject.mockResolvedValue(undefined);
    attachWithin.mockRejectedValue(new ManualDepositAttachmentConflictError());
    await expect(service.upload('business-id', 'branch-id', 'deposit-id', actor, file))
      .rejects.toBeInstanceOf(ConflictException);
    expect(deleteObject).toHaveBeenCalledWith(
      expect.stringMatching(/^private\/manual-deposit-attachments\//u),
    );
  });
});
