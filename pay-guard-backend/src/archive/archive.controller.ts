import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Res, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ArchiveService } from './archive.service';
import { RetrieveArchivedRecordDto } from './dto/archive.dto';

@ApiTags('Platform Archive')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles('PLATFORM_SUPER_ADMIN')
@Controller('platform/archive')
export class ArchiveController {
  constructor(private readonly archives: ArchiveService) {}

  @Get('batches')
  list(@CurrentUser() actor: AuthenticatedPrincipal) {
    return this.archives.list(actor);
  }

  @Post('batches/:batchId/records/:recordId/retrieve')
  async retrieve(
    @Param('batchId', new ParseUUIDPipe()) batchId: string,
    @Param('recordId', new ParseUUIDPipe()) recordId: string,
    @Body() input: RetrieveArchivedRecordDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.archives.retrieve(batchId, recordId, input.reason, actor);
    const safeName = file.fileName.replace(/[^a-zA-Z0-9._-]/gu, '_');
    return reply.header('Content-Type', file.contentType)
      .header('Content-Length', String(file.body.byteLength))
      .header('Content-Disposition', `attachment; filename="${safeName}"`)
      .header('Digest', `sha-256=${Buffer.from(file.sha256, 'hex').toString('base64')}`)
      .header('X-Content-Type-Options', 'nosniff').send(file.body);
  }
}
