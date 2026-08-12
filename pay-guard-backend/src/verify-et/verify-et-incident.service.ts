import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { V2AuditService } from '../audit/v2-audit.service';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CentralDao } from '../database/central.dao';
import {
  AcknowledgeVerifyEtIncidentDto,
  ListVerifyEtIncidentsDto,
} from './dto/verify-et-incident.dto';
import {
  VerifyEtIncident,
  VerifyEtIncidentAcknowledgementConflictError,
  VerifyEtIncidentDao,
  VerifyEtIncidentNotFoundError,
} from './verify-et-incident.dao';

@Injectable()
export class VerifyEtIncidentService {
  constructor(
    private readonly dao: CentralDao,
    private readonly incidents: VerifyEtIncidentDao,
    private readonly audit: V2AuditService,
  ) {}

  list(
    input: ListVerifyEtIncidentsDto,
    actor: AuthenticatedPrincipal,
  ): Promise<VerifyEtIncident[]> {
    this.assertPlatformAdmin(actor);
    return this.incidents.list({
      severity: input.severity,
      status: input.status,
      limit: input.limit,
      offset: input.offset,
    });
  }

  async require(
    id: string,
    actor: AuthenticatedPrincipal,
  ): Promise<VerifyEtIncident> {
    this.assertPlatformAdmin(actor);
    try {
      return await this.incidents.require(id);
    } catch (error) {
      if (error instanceof VerifyEtIncidentNotFoundError) {
        throw new NotFoundException('Provider incident was not found');
      }
      throw error;
    }
  }

  async acknowledge(
    id: string,
    input: AcknowledgeVerifyEtIncidentDto,
    actor: AuthenticatedPrincipal,
  ): Promise<VerifyEtIncident> {
    this.assertPlatformAdmin(actor);
    try {
      return await this.dao.transaction(async (transaction) => {
        const incident = await this.incidents.acknowledgeWithin(transaction, {
          id,
          platformAdminId: actor.userId,
          note: input.note,
        });
        await this.audit.recordWithin(transaction, {
          actor: {
            identityType: 'PLATFORM_ADMIN',
            subjectId: actor.userId,
            role: 'PLATFORM_SUPER_ADMIN',
          },
          sessionId: actor.sessionId,
          actionType: 'VERIFYET_INCIDENT_ACKNOWLEDGED',
          recordType: 'SECURITY_ALERT',
          recordId: incident.id,
          newValue: {
            status: incident.status,
            severity: incident.severity,
            errorCode: incident.errorCode,
          },
        });
        return incident;
      });
    } catch (error) {
      if (error instanceof VerifyEtIncidentNotFoundError) {
        throw new NotFoundException('Provider incident was not found');
      }
      if (error instanceof VerifyEtIncidentAcknowledgementConflictError) {
        throw new ConflictException(
          'Provider incident was already acknowledged differently',
        );
      }
      throw error;
    }
  }

  private assertPlatformAdmin(actor: AuthenticatedPrincipal): void {
    if (
      actor.role !== 'PLATFORM_SUPER_ADMIN' ||
      actor.identityType !== 'PLATFORM_ADMIN'
    ) {
      throw new ForbiddenException('Platform Super Admin access required');
    }
  }
}
