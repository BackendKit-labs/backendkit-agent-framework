import { IsString, IsNotEmpty, MinLength, IsOptional, Matches } from 'class-validator';

export class CreateDepartmentDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  name: string;

  @IsString()
  @IsOptional()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must be lowercase letters, numbers and hyphens only' })
  slug?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  icon?: string;

  @IsString()
  @IsOptional()
  color?: string;
}
