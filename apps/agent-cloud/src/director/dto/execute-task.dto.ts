import { IsString, IsNotEmpty, IsOptional, IsObject, IsArray, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class ExecuteTaskDto {
  @IsUUID()
  @IsNotEmpty()
  agentId: string;

  @IsString()
  @IsNotEmpty()
  task: string;

  @IsOptional()
  @IsObject()
  context?: Record<string, any>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tools?: string[];

  @IsOptional()
  @IsObject()
  parameters?: Record<string, any>;
}