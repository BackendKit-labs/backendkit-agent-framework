import { IsString, IsNotEmpty, MinLength, IsOptional, IsIn, IsObject } from 'class-validator';

export class CreateAgentDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['backend', 'qa', 'design', 'security', 'infra', 'codex', 'custom'])
  type: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, any>;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsString()
  @IsIn(['docker', 'k8s', 'process'])
  runtime?: string;
}