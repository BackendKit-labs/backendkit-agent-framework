import {
  IsString,
  IsNotEmpty,
  MinLength,
  IsOptional,
  IsIn,
  IsUUID,
  IsInt,
  Min,
  Max,
  IsUrl,
} from 'class-validator';
import type { DeployableKind, AppFramework } from '../entities/deployable.entity';

export class CreateDeployableDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsIn(['agent', 'app'])
  kind: DeployableKind;

  @IsUUID()
  @IsOptional()
  departmentId?: string;

  @IsString()
  @IsOptional()
  catalogKey?: string;

  @IsString()
  @IsOptional()
  image?: string;

  @IsString()
  @IsOptional()
  @IsIn(['docker', 'k8s', 'process'])
  runtime?: string;

  // Agent-specific
  @IsString()
  @IsOptional()
  model?: string;

  @IsInt()
  @Min(1024)
  @Max(65535)
  @IsOptional()
  mcpPort?: number;

  // App-specific
  @IsInt()
  @Min(1024)
  @Max(65535)
  @IsOptional()
  publicPort?: number;

  @IsUrl()
  @IsOptional()
  publicUrl?: string;

  @IsString()
  @IsOptional()
  @IsIn(['nextjs', 'fastapi', 'express', 'custom'])
  framework?: AppFramework;
}
