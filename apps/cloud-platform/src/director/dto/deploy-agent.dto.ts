import { IsString, IsNotEmpty } from 'class-validator';

export class DeployAgentDto {
  @IsString()
  @IsNotEmpty()
  agentId: string;
}