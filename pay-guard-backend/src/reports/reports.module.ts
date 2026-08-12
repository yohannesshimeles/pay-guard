import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FinancialReportDao } from './financial-report.dao';
import { FinancialReportService } from './financial-report.service';
import { ReportsController } from './reports.controller';
import { PlatformReportsController } from './reports.controller';
import { OperationalReportDao } from './operational-report.dao';
import { OperationalReportService } from './operational-report.service';
import { ReportExportDao } from './report-export.dao';
import { ReportExportService } from './report-export.service';
import { ReportExportWorker } from './report-export.worker';

@Module({
  imports: [AuthModule],
  controllers: [ReportsController, PlatformReportsController],
  providers: [
    FinancialReportDao, FinancialReportService,
    OperationalReportDao, OperationalReportService,
    ReportExportDao, ReportExportService, ReportExportWorker,
  ],
  exports: [
    FinancialReportDao, FinancialReportService,
    OperationalReportDao, OperationalReportService,
    ReportExportDao, ReportExportService, ReportExportWorker,
  ],
})
export class ReportsModule {}
