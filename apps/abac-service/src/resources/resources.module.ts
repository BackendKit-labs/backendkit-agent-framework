import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DepartmentResource } from '../entities/department-resource.entity';
import { User } from '../entities/user.entity';
import { ResourcesService } from './resources.service';
import { ResourcesController } from './resources.controller';

@Module({
    imports: [TypeOrmModule.forFeature([DepartmentResource, User])],
    providers: [ResourcesService],
    controllers: [ResourcesController],
    exports: [ResourcesService],
})
export class ResourcesModule {}
