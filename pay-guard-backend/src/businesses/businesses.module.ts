import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BusinessesController } from './businesses.controller';
import { BusinessesService } from './businesses.service';
import { BusinessesFacadeService } from './businesses-facade.service';
import { V2BusinessesService } from './v2-businesses.service';

@Module({
  imports: [AuthModule],
  controllers: [BusinessesController],
  providers: [BusinessesService, V2BusinessesService, BusinessesFacadeService],
})
export class BusinessesModule {}
