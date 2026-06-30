import { IsOptional, IsString, IsInt, Min, Max, IsIn, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryDeployableDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['agent', 'app'])
  kind?: string;

  @IsOptional()
  @IsIn(['pending', 'starting', 'running', 'stopped', 'error'])
  status?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
