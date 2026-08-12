import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  FinancialSummaryQueryDto, OperationalSummaryQueryDto, ProviderSummaryQueryDto,
} from './dto/financial-report.dto';
import { FinancialReportService } from './financial-report.service';
import { OperationalReportService } from './operational-report.service';
import { CreateReportExportDto } from './dto/report-export.dto';
import { ReportExportService } from './report-export.service';

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles('BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER', 'CASHIER')
@Controller('businesses/:businessId/reports')
export class ReportsController {
  constructor(
    private readonly reports: FinancialReportService,
    private readonly operations: OperationalReportService,
    private readonly exports: ReportExportService,
  ) {}

  @Get('financial-summary')
  financialSummary(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Query() input: FinancialSummaryQueryDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.reports.summary(businessId, input, actor);
  }

  @Get('operational-summary')
  operationalSummary(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Query() input: OperationalSummaryQueryDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.operations.businessSummary(businessId, input, actor);
  }

  @Post('exports')
  createExport(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Body() input: CreateReportExportDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.exports.create(businessId, input, actor);
  }

  @Get('exports/:jobId')
  requireExport(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('jobId', new ParseUUIDPipe()) jobId: string,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.exports.require(businessId, jobId, actor);
  }

  @Get('exports/:jobId/download')
  async downloadExport(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('jobId', new ParseUUIDPipe()) jobId: string,
    @CurrentUser() actor: AuthenticatedPrincipal,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.exports.download(businessId, jobId, actor);
    const safeName = file.fileName.replace(/[^a-zA-Z0-9._-]/gu, '_');
    return reply
      .header('Content-Type', file.contentType)
      .header('Content-Length', String(file.body.byteLength))
      .header('Content-Disposition', `attachment; filename="${safeName}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .send(Buffer.from(file.body));
  }
}

@ApiTags('Platform Reports')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles('PLATFORM_SUPER_ADMIN')
@Controller('platform/reports')
export class PlatformReportsController {
  constructor(private readonly reports: OperationalReportService) {}

  @Get('provider-summary')
  providerSummary(
    @Query() input: ProviderSummaryQueryDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.reports.providerSummary(input, actor);
  }
}
