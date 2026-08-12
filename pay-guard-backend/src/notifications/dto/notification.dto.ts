import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { NOTIFICATION_TYPES, NotificationType } from '../notification.models';

export class ListNotificationsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  offset = 0;
}

export class UpdateNotificationPreferenceDto {
  @IsIn(NOTIFICATION_TYPES)
  notificationType!: NotificationType;

  @IsBoolean()
  inAppEnabled!: boolean;

  @IsBoolean()
  pushEnabled!: boolean;
}

export class RegisterNotificationDeviceDto {
  @IsIn(['android', 'ios', 'web'])
  platform!: 'android' | 'ios' | 'web';

  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  token!: string;
}
