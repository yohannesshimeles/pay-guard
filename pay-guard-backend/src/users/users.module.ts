import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersFacadeService } from './users-facade.service';
import { UsersService } from './users.service';
import { V2UsersService } from './v2-users.service';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService, V2UsersService, UsersFacadeService],
})
export class UsersModule {}
