import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsArray,
  IsObject,
  IsBoolean,
  Matches,
} from 'class-validator';

export class CreateCatalogEntryDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9][a-z0-9-]*$/, { message: 'key must be kebab-case (a-z, 0-9, hyphens)' })
  key: string;

  @IsString()
  @IsNotEmpty()
  displayName: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsIn(['agent', 'app'])
  @IsOptional()
  kind?: 'agent' | 'app';

  @IsString()
  @IsNotEmpty()
  image: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  command?: string[];

  @IsObject()
  @IsOptional()
  env?: Record<string, string>;

  @IsString()
  @IsOptional()
  defaultModel?: string;

  @IsIn(['docker', 'k8s', 'process'])
  @IsOptional()
  runtime?: string;

  /** UPPER_SNAKE_CASE keys that must exist in the dept secrets before deploy. */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  requiredSecrets?: string[];

  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;
}
