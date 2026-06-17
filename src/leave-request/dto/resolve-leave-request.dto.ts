import { IsOptional, IsString } from 'class-validator';

export class ResolveLeaveRequestDto {
  @IsOptional()
  @IsString()
  note?: string;
}
