import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateStaffDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @MinLength(12)
  temporaryPassword!: string;

  @IsIn(['MANAGER', 'CASHIER', 'WAITER'])
  role!: 'MANAGER' | 'CASHIER' | 'WAITER';

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsIn(['Male', 'Female'])
  gender?: 'Male' | 'Female';
}

export class RemoveStaffDto {
  @IsString()
  @MinLength(5)
  reason!: string;
}
