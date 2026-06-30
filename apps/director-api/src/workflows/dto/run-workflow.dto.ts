import { IsObject, IsOptional } from 'class-validator';

export class RunWorkflowDto {
  @IsObject()
  @IsOptional()
  input?: Record<string, any>;
}
