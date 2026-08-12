import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BranchesController } from './branches.controller';
import { BranchesFacadeService } from './branches-facade.service';
import { BranchesService } from './branches.service';
import { V2BranchesService } from './v2-branches.service';

@Module({
  imports: [AuthModule],
  controllers: [BranchesController],
  providers: [BranchesService, V2BranchesService, BranchesFacadeService],
})
export class BranchesModule {}
