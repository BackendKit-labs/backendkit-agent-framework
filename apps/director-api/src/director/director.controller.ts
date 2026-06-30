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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FlexAuthGuard } from '../auth/guards/flex-auth.guard';

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
  @UseGuards(FlexAuthGuard)
  getAgents() {
    return this.directorService.getDeployedAgents();
  }

  @Post('deploy')
  @UseGuards(FlexAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  deploy(@Body() deployAgentDto: DeployAgentDto) {
    return this.directorService.deployAgent(deployAgentDto);
  }

  @Post(':id/stop')
  @UseGuards(FlexAuthGuard)
  @HttpCode(HttpStatus.OK)
  stop(@Param('id') id: string) {
    return this.directorService.stopAgent(id);
  }

  @Post('execute/:id')
  @UseGuards(FlexAuthGuard)
  @HttpCode(HttpStatus.OK)
  execute(@Param('id') id: string, @Body() executeActionDto: ExecuteActionDto) {
    return this.directorService.executeAgent(id, executeActionDto);
  }

  @Get('agents/:id/logs')
  @UseGuards(FlexAuthGuard)
  getLogs(@Param('id') id: string) {
    return this.directorService.getAgentLogs(id);
  }

  @Get('metrics')
  @UseGuards(FlexAuthGuard)
  getMetrics() {
    return this.directorService.getMetrics();
  }
}