import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ArchiveController } from './archive.controller';
import { ArchiveCryptoService } from './archive-crypto.service';
import { ArchiveDao } from './archive.dao';
import { ArchiveService } from './archive.service';
import { ArchiveWorker } from './archive.worker';

@Module({
  imports: [AuthModule],
  controllers: [ArchiveController],
  providers: [ArchiveCryptoService, ArchiveDao, ArchiveService, ArchiveWorker],
  exports: [ArchiveCryptoService, ArchiveDao, ArchiveService, ArchiveWorker],
})
export class ArchiveModule {}
