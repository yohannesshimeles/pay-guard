import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  V2AuthIdentity,
  V2AuthorizationContext,
  V2ContextSelection,
  V2ContextSelectionResult,
  V2SelectedAuthContext,
} from './v2-auth.types';

@Injectable()
export class V2ContextSelectorService {
  select(
    identity: V2AuthIdentity,
    selection?: V2ContextSelection,
  ): V2ContextSelectionResult {
    if (identity.identityType === 'PLATFORM_ADMIN') {
      if (selection) {
        throw new ForbiddenException(
          'Platform administrators cannot select a business context',
        );
      }
      return {
        status: 'SELECTED',
        context: {
          identityType: 'PLATFORM_ADMIN',
          subjectId: identity.id,
          role: 'PLATFORM_SUPER_ADMIN',
        },
      };
    }

    if (identity.contexts.length === 0) {
      throw new ForbiddenException('No active authorization context is available');
    }

    if (!selection && identity.contexts.length > 1) {
      return {
        status: 'SELECTION_REQUIRED',
        contexts: identity.contexts.map((context) => ({ ...context })),
      };
    }

    const selected = selection
      ? identity.contexts.find((context) => this.matches(context, selection))
      : identity.contexts[0];
    if (!selected) {
      throw new ForbiddenException(
        'The selected authorization context is not active',
      );
    }

    return {
      status: 'SELECTED',
      context: this.toSelectedContext(identity.id, selected),
    };
  }

  private matches(
    context: V2AuthorizationContext,
    selection: V2ContextSelection,
  ): boolean {
    return (
      context.membershipId === selection.membershipId &&
      context.membershipRoleId === selection.membershipRoleId &&
      context.workAssignmentId === selection.workAssignmentId
    );
  }

  private toSelectedContext(
    subjectId: string,
    context: V2AuthorizationContext,
  ): V2SelectedAuthContext {
    return {
      identityType: 'BUSINESS_USER',
      subjectId,
      role: context.role,
      businessId: context.businessId,
      membershipId: context.membershipId,
      membershipRoleId: context.membershipRoleId,
      workAssignmentId: context.workAssignmentId,
      workScope: context.workScope,
      branchId: context.branchId,
    };
  }
}
