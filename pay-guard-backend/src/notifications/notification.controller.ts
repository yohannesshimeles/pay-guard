import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ListNotificationsDto, RegisterNotificationDeviceDto, UpdateNotificationPreferenceDto } from './dto/notification.dto';
import { NotificationService } from './notification.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  list(@Query() query: ListNotificationsDto,
    @CurrentUser() actor: AuthenticatedPrincipal) {
    return this.notifications.list(actor, query.limit, query.offset);
  }

  @Patch(':notificationId/read')
  markRead(
    @Param('notificationId', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) { return this.notifications.markRead(actor, id); }

  @Get('preferences')
  preferences(@CurrentUser() actor: AuthenticatedPrincipal) {
    return this.notifications.preferences(actor);
  }

  @Patch('preferences')
  updatePreference(
    @Body() input: UpdateNotificationPreferenceDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) { return this.notifications.updatePreference(actor, input); }

  @Post('devices')
  registerDevice(
    @Body() input: RegisterNotificationDeviceDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) { return this.notifications.registerDevice(actor, input); }

  @Delete('devices/:deviceId')
  deactivateDevice(
    @Param('deviceId', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) { return this.notifications.deactivateDevice(actor, id); }
}
