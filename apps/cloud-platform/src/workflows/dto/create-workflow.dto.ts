import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsUUID,
  IsArray,
  ValidateNested,
  IsInt,
  Min,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateWorkflowStepDto {
  @IsInt()
  @Min(1)
  order: number;

  @IsUUID()
  @IsOptional()
  deployableId?: string;

  @IsObject()
  @IsOptional()
  config?: Record<string, any>;
}

export class CreateWorkflowDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsIn(['draft', 'active', 'paused'])
  @IsOptional()
  status?: 'draft' | 'active' | 'paused';

  @IsIn(['manual', 'webhook', 'scheduled'])
  @IsOptional()
  trigger?: 'manual' | 'webhook' | 'scheduled';

  @IsUUID()
  @IsOptional()
  departmentId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateWorkflowStepDto)
  @IsOptional()
  steps?: CreateWorkflowStepDto[];
}
