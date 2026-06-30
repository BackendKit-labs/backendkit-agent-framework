import {
  IsString,
  IsOptional,
  IsArray,
  MaxLength,
} from 'class-validator';

export class UpdateProjectDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  root?: string;

  @IsOptional()
  @IsArray()
  agents?: any[];

  @IsOptional()
  @IsArray()
  policies?: any[];

  @IsOptional()
  @IsArray()
  gates?: any[];
}