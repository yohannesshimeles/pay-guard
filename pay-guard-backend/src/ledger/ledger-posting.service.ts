import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CentralDao } from '../database/central.dao';
import {
  LedgerAccountNotFoundError,
  LedgerDao,
  LedgerEntryNotFoundError,
  LedgerPostingConflictError,
  PostLedgerEntry,
  ReverseLedgerEntry,
} from './ledger.dao';

@Injectable()
export class LedgerPostingService {
  constructor(
    private readonly centralDao: CentralDao,
    private readonly ledger: LedgerDao,
  ) {}

  post(input: PostLedgerEntry) {
    this.validate(input);
    return this.change(() =>
      this.centralDao.transaction((transaction) =>
        this.ledger.postWithin(transaction, input),
      ),
    );
  }

  reverse(input: ReverseLedgerEntry) {
    this.validate(input);
    return this.change(() =>
      this.centralDao.transaction((transaction) =>
        this.ledger.reverseWithin(transaction, input),
      ),
    );
  }

  private validate(input: PostLedgerEntry | ReverseLedgerEntry): void {
    if (
      !/^\d{1,16}(\.\d{1,2})?$/u.test('amount' in input ? input.amount : '1') ||
      ('amount' in input && Number(input.amount) <= 0) ||
      Number.isNaN(input.actualTransactionAt.getTime()) ||
      !/^[A-Z][A-Z0-9_]{2,39}$/u.test(input.sourceRecordType) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{15,159}$/u.test(input.idempotencyKey) ||
      input.description.trim().length < 3 || input.description.length > 1000
    ) {
      throw new Error('Ledger posting input is invalid');
    }
  }

  private async change<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (
        error instanceof LedgerAccountNotFoundError ||
        error instanceof LedgerEntryNotFoundError
      ) {
        throw new NotFoundException('Ledger account or entry not found');
      }
      if (error instanceof LedgerPostingConflictError) {
        throw new ConflictException('Ledger idempotency conflict');
      }
      throw error;
    }
  }
}
