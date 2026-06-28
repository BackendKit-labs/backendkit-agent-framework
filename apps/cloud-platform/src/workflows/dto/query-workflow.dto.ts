import { IsOptional, IsUUID, IsIn } from 'class-validator';

export class QueryWorkflowDto {
  @IsUUID()
  @IsOptional()
  departmentId?: string;

  @IsIn(['draft', 'active', 'paused'])
  @IsOptional()
  status?: 'draft' | 'active' | 'paused';
}
