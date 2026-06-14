# Vault Manager

Web dashboard para gestión de vaults de conocimiento — ingesta, auditoría y mejora con AI.

## Stack

- Next.js 14 · Tailwind CSS · Radix UI
- Drizzle ORM + LibSQL (SQLite)
- NextAuth v5 (credentials)
- DeepSeek para el loop de mejora AI

## Instalación

```bash
# Desde la raíz de agent-framework
npm install
```

## Configuración

```bash
cd apps/vault-manager
copy .env.example .env
```

Editá `.env` y completá estas dos variables:

```env
NEXTAUTH_SECRET=cualquier-string-largo
DEEPSEEK_API_KEY=sk-tu-key
```

Las demás variables tienen defaults correctos.

## Base de datos

```bash
# Desde apps/vault-manager/
npx drizzle-kit push
```

## Setup inicial

Crea el usuario admin y los vault definitions por defecto:

```bash
npx tsx lib/setup.ts
```

Credenciales creadas:
- **Email:** `admin@empresa.com`
- **Password:** `admin123`

## Levantar

```bash
npm run dev
```

Accedé en `http://localhost:3000`.

## Vaults por defecto

| Vault | Rol | Path |
|---|---|---|
| AI Engineering | technical | `AI_VAULT_PATH` |
| TypeScript Patterns | technical | `TS_VAULT_PATH` |
| Architecture Patterns | technical | `ARCH_VAULT_PATH` |
| Empresa | business | `COMPANY_VAULT_PATH` |

## Roles de usuario

| Rol | Acceso |
|---|---|
| `admin` | Todos los vaults + gestión de usuarios |
| `technical` | Vaults técnicos (AI, TypeScript, Architecture) |
| `business` | Vault de empresa (procesos, normas) |
| `viewer` | Solo lectura |

## Scripts

```bash
npm run dev          # desarrollo
npm run build        # build producción
npm run typecheck    # verificar tipos
npx drizzle-kit push # aplicar schema a DB
npx tsx lib/setup.ts # setup inicial (una sola vez)
```
