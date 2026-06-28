import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  MaxLength,
} from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  root: string;

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