import { IsUUID, IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateLeaveRequestDto {
  @IsUUID()
  employeeId: string;

  @IsUUID()
  locationId: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsString()
  note?: string;
}
