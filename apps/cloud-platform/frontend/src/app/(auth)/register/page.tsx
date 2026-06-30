'use client';

import Link from 'next/link';
import { LogIn, ShieldAlert } from 'lucide-react';

export default function RegisterPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4 py-12">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-600/20 shadow-lg mb-6">
          <ShieldAlert className="h-8 w-8 text-amber-400" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-white mb-2">
          Acceso por invitación
        </h2>
        <p className="text-slate-400 text-sm mb-8">
          Las cuentas son creadas por el administrador de tu organización.
          Contacta a tu administrador para solicitar acceso.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
        >
          <LogIn className="h-4 w-4" />
          Ir al inicio de sesión
        </Link>
      </div>
    </div>
  );
}
