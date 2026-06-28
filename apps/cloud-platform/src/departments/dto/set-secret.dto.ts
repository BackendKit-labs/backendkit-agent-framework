import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class SetSecretDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message: 'key must be UPPER_SNAKE_CASE (e.g. CODEX_API_KEY)',
  })
  key: string;

  @IsString()
  @IsNotEmpty()
  value: string;
}
