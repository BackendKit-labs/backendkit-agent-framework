import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { DirectorService } from './director.service';
import { DeployAgentDto } from './dto/deploy-agent.dto';
import { ExecuteActionDto } from './dto/execute-action.dto';
import { FlexAuthGuard } from '../auth/guards/flex-auth.guard';
import { AuthzGuard } from '../auth/guards/authz.guard';
import { RequireTool } from '../common/decorators';

@Controller('director')
export class DirectorController {
  constructor(private readonly directorService: DirectorService) {}

  @Get('status')
  getStatus() {
    return this.directorService.getStatus();
  }

  @Get('health')
  getHealth() {
    return this.directorService.getHealth();
  }

  @Get('runtimes')
  getRuntimes() {
    return this.directorService.getRuntimes();
  }

  @Get('catalog')
  getCatalog(@Query('category') category?: string) {
    return this.directorService.getCatalog(category);
  }

  @Get('agents')
  @UseGuards(FlexAuthGuard, AuthzGuard)
  @RequireTool('cloud_deployed_agents')
  getAgents() {
    return this.directorService.getDeployedAgents();
  }

  @Post('deploy')
  @UseGuards(FlexAuthGuard, AuthzGuard)
  @RequireTool('cloud_deploy')
  @HttpCode(HttpStatus.CREATED)
  deploy(@Body() deployAgentDto: DeployAgentDto) {
    return this.directorService.deployAgent(deployAgentDto);
  }

  @Post(':id/stop')
  @UseGuards(FlexAuthGuard, AuthzGuard)
  @RequireTool('cloud_stop')
  @HttpCode(HttpStatus.OK)
  stop(@Param('id') id: string) {
    return this.directorService.stopAgent(id);
  }

  @Post('execute/:id')
  @UseGuards(FlexAuthGuard, AuthzGuard)
  @RequireTool('cloud_deploy')
  @HttpCode(HttpStatus.OK)
  execute(@Param('id') id: string, @Body() executeActionDto: ExecuteActionDto) {
    return this.directorService.executeAgent(id, executeActionDto);
  }

  @Get('agents/:id/logs')
  @UseGuards(FlexAuthGuard, AuthzGuard)
  @RequireTool('cloud_deployed_agents')
  getLogs(@Param('id') id: string) {
    return this.directorService.getAgentLogs(id);
  }

  @Get('metrics')
  @UseGuards(FlexAuthGuard, AuthzGuard)
  @RequireTool('cloud_metrics')
  getMetrics() {
    return this.directorService.getMetrics();
  }
}