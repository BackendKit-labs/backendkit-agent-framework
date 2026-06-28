import { IsOptional, IsObject, IsString, IsNumber, IsBoolean, IsArray } from 'class-validator';

export class UpdateAgentConfigDto {
  @IsOptional()
  @IsObject()
  environment?: Record<string, string>;

  @IsOptional()
  @IsObject()
  resources?: {
    cpu?: string;
    memory?: string;
    disk?: string;
  };

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedTools?: string[];

  @IsOptional()
  @IsNumber()
  maxConcurrentTasks?: number;

  @IsOptional()
  @IsBoolean()
  autoRestart?: boolean;

  @IsOptional()
  @IsObject()
  customConfig?: Record<string, any>;
}