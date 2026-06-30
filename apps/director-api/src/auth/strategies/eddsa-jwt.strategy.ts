import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface DirectorUser {
  id: string;
  email: string | null;
  org: string | null;
  orgSlug: string | null;
  roles: string[];
  permissions: string[];
}

interface AbacJwtPayload {
  sub: string;
  email?: string;
  type?: string;
  accountType?: string;
  org?: string | null;
  orgSlug?: string | null;
  appId?: string;
  roles?: string[];
  permissions?: string[];
}

function toSpkiPem(base64RawKey: string): string {
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  const rawKey = Buffer.from(base64RawKey, 'base64');
  if (rawKey.length !== 32) {
    throw new Error(
      `ABAC_PUBLIC_KEY debe ser clave Ed25519 de 32 bytes (recibidos: ${rawKey.length})`,
    );
  }
  return `-----BEGIN PUBLIC KEY-----\n${Buffer.concat([prefix, rawKey]).toString('base64')}\n-----END PUBLIC KEY-----`;
}

@Injectable()
export class EdDsaJwtStrategy extends PassportStrategy(Strategy, 'eddsa-jwt') {
  private static readonly logger = new Logger(EdDsaJwtStrategy.name);

  constructor() {
    const rawKey = process.env.ABAC_PUBLIC_KEY;
    const secretOrKey = rawKey
      ? toSpkiPem(rawKey)
      : toSpkiPem(Buffer.alloc(32).toString('base64'));

    if (!rawKey) {
      EdDsaJwtStrategy.logger.warn(
        'ABAC_PUBLIC_KEY no configurado — validación EdDSA deshabilitada (toda solicitud Bearer fallará)',
      );
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey,
      algorithms: ['EdDSA'],
    });
  }

  async validate(payload: AbacJwtPayload): Promise<DirectorUser> {
    if (!payload?.sub) {
      throw new UnauthorizedException('Token abac-service inválido: falta sub');
    }
    return {
      id: payload.sub,
      email: payload.email ?? null,
      org: payload.org ?? null,
      orgSlug: payload.orgSlug ?? null,
      roles: payload.roles ?? [],
      permissions: payload.permissions ?? [],
    };
  }
}
