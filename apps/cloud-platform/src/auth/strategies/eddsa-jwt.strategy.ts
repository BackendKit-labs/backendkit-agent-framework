import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthenticatedUser } from './jwt.strategy';

interface AbacJwtPayload {
  sub: string;
  type?: string;
  accountType?: string;
  org?: string | null;
  orgSlug?: string | null;
  applicationId?: string;
  applicationName?: string;
}

/**
 * Convierte una clave pública Ed25519 raw (32 bytes base64) a PEM SPKI.
 * jsonwebtoken 9.x puede verificar EdDSA con una clave PEM en formato SPKI.
 */
function toSpkiPem(base64RawKey: string): string {
  // DER prefix para Ed25519 SPKI (RFC 8410)
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  const rawKey = Buffer.from(base64RawKey, 'base64');
  if (rawKey.length !== 32) {
    throw new Error(
      `ABAC_PUBLIC_KEY debe ser una clave Ed25519 de 32 bytes (recibidos: ${rawKey.length})`,
    );
  }
  const der = Buffer.concat([prefix, rawKey]);
  return `-----BEGIN PUBLIC KEY-----\n${der.toString('base64')}\n-----END PUBLIC KEY-----`;
}

@Injectable()
export class EdDsaJwtStrategy extends PassportStrategy(Strategy, 'eddsa-jwt') {
  private static readonly logger = new Logger(EdDsaJwtStrategy.name);

  constructor() {
    const rawKey = process.env.ABAC_PUBLIC_KEY;

    // Si no está configurado usamos una clave dummy (32 ceros). Toda verificación fallará
    // con 401 y FlexAuthGuard caerá al siguiente strategy — nunca falla en el arranque.
    const secretOrKey = rawKey
      ? toSpkiPem(rawKey)
      : toSpkiPem(Buffer.alloc(32).toString('base64'));

    if (!rawKey) {
      EdDsaJwtStrategy.logger.warn(
        'ABAC_PUBLIC_KEY no configurado — validación de tokens EdDSA deshabilitada',
      );
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey,
      algorithms: ['EdDSA'],
    });
  }

  async validate(payload: AbacJwtPayload): Promise<AuthenticatedUser> {
    if (!payload?.sub) {
      throw new UnauthorizedException('Token abac-service inválido: falta sub');
    }
    return {
      id: payload.sub,
      role: null,
      dept: null,
      tools: [],
      vault: [],
      apps: [],
      email: null,
      org: payload.org ?? null,
      orgSlug: payload.orgSlug ?? null,
      accountType: payload.accountType,
    };
  }
}
