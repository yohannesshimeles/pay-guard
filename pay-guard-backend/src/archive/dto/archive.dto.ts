import { IsString, Length } from 'class-validator';

export class RetrieveArchivedRecordDto {
  @IsString()
  @Length(10, 500)
  reason!: string;
}
