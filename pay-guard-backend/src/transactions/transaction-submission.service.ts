import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import {
  TransactionSubmissionConflictError,
  TransactionSubmissionDao,
  TransactionSubmissionScopeError,
} from './transaction-submission.dao';

@Injectable()
export class TransactionSubmissionService {
  constructor(private readonly submissions: TransactionSubmissionDao) {}

  async create(
    businessId: string,
    branchId: string,
    input: CreateTransactionDto,
    actor: AuthenticatedPrincipal,
  ) {
    if (
      !actor.businessIds.includes(businessId) ||
      actor.branchId !== branchId ||
      !actor.workAssignmentId
    ) {
      throw new ForbiddenException('Active branch assignment required');
    }
    if (Number(input.amount) <= 0) {
      throw new UnprocessableEntityException('Amount must be greater than zero');
    }
    try {
      return await this.submissions.create({
        ...input,
        businessId,
        branchId,
        workAssignmentId: actor.workAssignmentId,
        submittedByUserId: actor.userId,
      });
    } catch (error) {
      if (error instanceof TransactionSubmissionConflictError) {
        throw new ConflictException(
          'Idempotency key was already used for a different transaction',
        );
      }
      if (error instanceof TransactionSubmissionScopeError) {
        throw new ForbiddenException(
          'Active business, branch, assignment and settlement account required',
        );
      }
      throw error;
    }
  }
}
