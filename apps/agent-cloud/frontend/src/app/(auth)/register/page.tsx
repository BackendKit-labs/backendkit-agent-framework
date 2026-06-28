'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import Button from '@/components/ui/button';
import Input from '@/components/ui/input';
import { Loader2, UserPlus, Eye, EyeOff, AlertCircle, CheckCircle } from 'lucide-react';

interface FormErrors {
  name?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    if (!name.trim()) {
      newErrors.name = 'El nombre es obligatorio';
    } else if (name.trim().length < 2) {
      newErrors.name = 'El nombre debe tener al menos 2 caracteres';
    } else if (name.trim().length > 100) {
      newErrors.name = 'El nombre no puede exceder 100 caracteres';
    }

    if (!email.trim()) {
      newErrors.email = 'El email es obligatorio';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      newErrors.email = 'Ingrese un email válido';
    }

    if (!password) {
      newErrors.password = 'La contraseña es obligatoria';
    } else if (password.length < 6) {
      newErrors.password = 'La contraseña debe tener al menos 6 caracteres';
    } else if (password.length > 100) {
      newErrors.password = 'La contraseña no puede exceder 100 caracteres';
    } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      newErrors.password = 'Debe contener mayúscula, minúscula y número';
    }

    if (!confirmPassword) {
      newErrors.confirmPassword = 'Confirme su contraseña';
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Las contraseñas no coinciden';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, email, password, confirmPassword]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setApiError(null);

      if (!validateForm()) return;

      setIsLoading(true);

      try {
        await register(name.trim(), email.trim().toLowerCase(), password);
        setIsSuccess(true);

        // Redirigir al dashboard después de 1.5 segundos
        setTimeout(() => {
          router.push('/dashboard');
        }, 1500);
      } catch (err: unknown) {
        if (err instanceof Error) {
          const message = err.message;

          if (message.includes('409') || message.toLowerCase().includes('already exists') || message.toLowerCase().includes('duplicate')) {
            setApiError('Este email ya está registrado. Intente iniciar sesión.');
          } else if (message.includes('400') || message.includes('validation')) {
            setApiError('Datos inválidos. Verifique la información ingresada.');
          } else if (message.includes('500')) {
            setApiError('Error del servidor. Intente nuevamente más tarde.');
          } else if (message.includes('network') || message.includes('fetch')) {
            setApiError('Error de conexión. Verifique su internet.');
          } else {
            setApiError(message || 'Error al registrarse. Intente nuevamente.');
          }
        } else {
          setApiError('Error inesperado. Intente nuevamente.');
        }
      } finally {
        setIsLoading(false);
      }
    },
    [name, email, password, validateForm, register, router]
  );

  const clearFieldError = useCallback((field: keyof FormErrors) => {
    setErrors((prev) => {
      const { [field]: _, ...rest } = prev;
      return rest;
    });
    setApiError(null);
  }, []);

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 px-4">
        <div className="w-full max-w-md">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <h2 className="mt-4 text-2xl font-bold text-slate-900 dark:text-white">
              ¡Registro exitoso!
            </h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Redirigiendo al dashboard...
            </p>
            <div className="mt-6 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/30 mb-4">
              <UserPlus className="h-7 w-7 text-indigo-600 dark:text-indigo-400" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              Crear cuenta
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Complete los datos para registrarse en Agent Cloud
            </p>
          </div>

          {/* API Error */}
          {apiError && (
            <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-400">
              <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <span>{apiError}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {/* Name */}
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Nombre completo
              </label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearFieldError('name');
                }}
                placeholder="Juan Pérez"
                error={errors.name}
                disabled={isLoading}
                autoComplete="name"
                autoFocus
                className={errors.name ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}
              />
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Correo electrónico
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearFieldError('email');
                }}
                placeholder="usuario@ejemplo.com"
                error={errors.email}
                disabled={isLoading}
                autoComplete="email"
                className={errors.email ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Contraseña
              </label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    clearFieldError('password');
                  }}
                  placeholder="Mínimo 6 caracteres"
                  error={errors.password}
                  disabled={isLoading}
                  autoComplete="new-password"
                  className={`pr-10 ${errors.password ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                Debe contener mayúscula, minúscula y número
              </p>
            </div>

            {/* Confirm Password */}
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Confirmar contraseña
              </label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    clearFieldError('confirmPassword');
                  }}
                  placeholder="Repita la contraseña"
                  error={errors.confirmPassword}
                  disabled={isLoading}
                  autoComplete="new-password"
                  className={`pr-10 ${errors.confirmPassword ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                  tabIndex={-1}
                  aria-label={showConfirmPassword ? 'Ocultar confirmación' : 'Mostrar confirmación'}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 h-11"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Registrando...
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4" />
                  Crear cuenta
                </>
              )}
            </Button>
          </form>

          {/* Footer */}
          <div className="mt-6 text-center">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              ¿Ya tiene una cuenta?{' '}
              <Link
                href="/login"
                className="font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
              >
                Iniciar sesión
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}