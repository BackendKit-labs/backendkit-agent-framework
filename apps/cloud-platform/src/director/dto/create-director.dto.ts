import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

export class CreateDirectorDto {
  @IsString()
  @IsNotEmpty()
  agentId: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, any>;
}