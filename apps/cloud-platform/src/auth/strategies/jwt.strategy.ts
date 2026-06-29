import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

/**
 * Claims emitidos por auth-service (único IdP del ecosistema).
 * Ver `apps/auth-service/README.md` y `.specs/adr-unified-auth.md`.
 */
interface AuthServiceJwtPayload {
  sub: string;
  role?: string;
  dept?: string;
  tools?: string[];
  vault?: string[];
  apps?: string[];
  email?: string;
}

/**
 * Forma proyectada en `req.user`. Stateless: derivada solo del token,
 * sin lookup a ninguna tabla local de usuarios.
 * Los campos `org`/`orgSlug`/`accountType` solo están presentes en tokens de abac-service.
 */
export interface AuthenticatedUser {
  id: string;
  role: string | null;
  dept: string | null;
  tools: string[];
  vault: string[];
  apps: string[];
  email: string | null;
  // abac-service claims (presentes cuando el token viene de abac-service)
  org?: string | null;
  orgSlug?: string | null;
  accountType?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    // auth-service es el único emisor de identidad. cloud-platform solo valida sus
    // JWT con la clave compartida AUTH_SECRET (ver .specs/adr-unified-auth.md).
    const secret = process.env.AUTH_SECRET;
    if (!secret) {
      throw new Error('AUTH_SECRET no configurado');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * passport-jwt ya verificó firma y expiración. Aquí solo proyectamos los
   * claims de auth-service a `req.user` — no se consulta la base de datos.
   */
  async validate(payload: AuthServiceJwtPayload): Promise<AuthenticatedUser> {
    if (!payload?.sub) {
      throw new UnauthorizedException('Invalid token: missing subject');
    }

    return {
      id: payload.sub,
      role: payload.role ?? null,
      dept: payload.dept ?? null,
      tools: payload.tools ?? [],
      vault: payload.vault ?? [],
      apps: payload.apps ?? [],
      email: payload.email ?? null,
    };
  }
}
