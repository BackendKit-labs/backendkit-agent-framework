import { PartialType } from '@nestjs/mapped-types';
import { CreateDeployableDto } from './create-deployable.dto';

export class UpdateDeployableDto extends PartialType(CreateDeployableDto) {}
