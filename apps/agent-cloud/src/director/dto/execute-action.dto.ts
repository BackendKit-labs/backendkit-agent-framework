import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

export class ExecuteActionDto {
  @IsString()
  @IsNotEmpty()
  action: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}