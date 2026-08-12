import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { CentralDao } from './central.dao';

@Global()
@Module({
  providers: [DatabaseService, CentralDao],
  exports: [DatabaseService, CentralDao],
})
export class DatabaseModule {}
