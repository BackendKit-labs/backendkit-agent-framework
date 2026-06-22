'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { BookOpen, Loader2, Eye, EyeOff } from 'lucide-react';
import { Button, Input, cn } from '@/components/ui';

export default function LoginPage() {
    const router = useRouter();
    const [email,     setEmail]     = useState('');
    const [password,  setPassword]  = useState('');
    const [showPass,  setShowPass]  = useState(false);
    const [loading,   setLoading]   = useState(false);
    const [error,     setError]     = useState('');

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError('');
        const result = await signIn('credentials', { email, password, redirect: false });
        setLoading(false);
        if (result?.error) {
            setError('Credenciales inválidas. Verificá usuario y contraseña.');
        } else {
            router.push('/');
            router.refresh();
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-background">
            {/* Background grid */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#1a1a2e_1px,transparent_1px),linear-gradient(to_bottom,#1a1a2e_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-30" />

            <div className="relative w-full max-w-sm animate-fade-in">
                {/* Logo */}
                <div className="mb-8 flex flex-col items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
                        <BookOpen className="h-6 w-6 text-primary" />
                    </div>
                    <div className="text-center">
                        <h1 className="text-xl font-semibold">Vault Manager</h1>
                        <p className="mt-1 text-sm text-muted-foreground">BackendKit Labs</p>
                    </div>
                </div>

                {/* Card */}
                <div className="rounded-xl border border-border bg-card p-8 shadow-xl">
                    <h2 className="mb-6 text-center text-sm font-medium text-muted-foreground">
                        Iniciá sesión para continuar
                    </h2>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Usuario</label>
                            <Input
                                type="text"
                                placeholder="admin o admin@empresa.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                autoFocus
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Contraseña</label>
                            <div className="relative">
                                <Input
                                    type={showPass ? 'text' : 'password'}
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    className="pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPass(!showPass)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                >
                                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                        </div>

                        {error && (
                            <p className="rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-xs text-red-400">
                                {error}
                            </p>
                        )}

                        <Button type="submit" className="w-full" disabled={loading}>
                            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                            {loading ? 'Verificando...' : 'Ingresar'}
                        </Button>
                    </form>
                </div>

                <p className="mt-4 text-center text-xs text-muted-foreground">
                    Contactá al administrador para obtener acceso
                </p>
            </div>
        </div>
    );
}
