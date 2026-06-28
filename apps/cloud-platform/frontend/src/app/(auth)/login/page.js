"use strict";
'use client';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = LoginPage;
const react_1 = __importStar(require("react"));
const navigation_1 = require("next/navigation");
const link_1 = __importDefault(require("next/link"));
const auth_context_1 = require("@/lib/auth-context");
const lucide_react_1 = require("lucide-react");
function LoginPage() {
    const router = (0, navigation_1.useRouter)();
    const { login } = (0, auth_context_1.useAuth)();
    const [email, setEmail] = (0, react_1.useState)('');
    const [password, setPassword] = (0, react_1.useState)('');
    const [showPassword, setShowPassword] = (0, react_1.useState)(false);
    const [error, setError] = (0, react_1.useState)(null);
    const [isLoading, setIsLoading] = (0, react_1.useState)(false);
    const handleSubmit = (0, react_1.useCallback)(async (e) => {
        e.preventDefault();
        setError(null);
        if (!email.trim()) {
            setError('El email es requerido');
            return;
        }
        if (!password.trim()) {
            setError('La contraseña es requerida');
            return;
        }
        setIsLoading(true);
        try {
            await login(email.trim(), password);
            router.push('/dashboard');
        }
        catch (err) {
            if (err instanceof Error) {
                setError(err.message);
            }
            else {
                setError('Error al iniciar sesión. Verifica tus credenciales.');
            }
        }
        finally {
            setIsLoading(false);
        }
    }, [email, password, login, router]);
    return (<div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        
        <div className="text-center mb-8">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-indigo-600 shadow-lg shadow-indigo-500/30">
            <lucide_react_1.LogIn className="h-8 w-8 text-white"/>
          </div>
          <h2 className="mt-6 text-3xl font-bold tracking-tight text-white">
            Agent Cloud
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Inicia sesión para acceder al dashboard
          </p>
        </div>

        
        <div className="rounded-xl bg-slate-800/60 backdrop-blur-sm border border-slate-700/50 shadow-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-6" noValidate>
            
            {error && (<div className="rounded-lg bg-red-900/30 border border-red-800/50 px-4 py-3 text-sm text-red-300">
                <div className="flex items-center gap-2">
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"/>
                  </svg>
                  <span>{error}</span>
                </div>
              </div>)}

            
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-1.5">
                Correo electrónico
              </label>
              <input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" className="block w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-sm text-white placeholder-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40 focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed" disabled={isLoading}/>
            </div>

            
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-1.5">
                Contraseña
              </label>
              <div className="relative">
                <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="block w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 pr-10 text-sm text-white placeholder-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40 focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed" disabled={isLoading}/>
                <button type="button" onClick={() => setShowPassword((prev) => !prev)} className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-200 transition-colors" tabIndex={-1} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
                  {showPassword ? (<lucide_react_1.EyeOff className="h-4 w-4"/>) : (<lucide_react_1.Eye className="h-4 w-4"/>)}
                </button>
              </div>
            </div>

            
            <button type="submit" disabled={isLoading} className="flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {isLoading ? (<>
                  <lucide_react_1.Loader2 className="mr-2 h-4 w-4 animate-spin"/>
                  Iniciando sesión...
                </>) : ('Iniciar sesión')}
            </button>
          </form>

          
          <p className="mt-6 text-center text-sm text-slate-400">
            ¿No tienes cuenta?{' '}
            <link_1.default href="/register" className="font-medium text-indigo-400 hover:text-indigo-300 transition-colors">
              Regístrate aquí
            </link_1.default>
          </p>
        </div>

        
        <p className="mt-6 text-center text-xs text-slate-500">
          &copy; {new Date().getFullYear()} Agent Cloud. Todos los derechos reservados.
        </p>
      </div>
    </div>);
}
//# sourceMappingURL=page.js.map