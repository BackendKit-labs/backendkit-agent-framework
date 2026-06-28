"use strict";
'use client';
Object.defineProperty(exports, "__esModule", { value: true });
exports.Navbar = Navbar;
const auth_context_1 = require("@/lib/auth-context");
const lucide_react_1 = require("lucide-react");
const button_1 = require("@/components/ui/button");
function Navbar({ onToggleSidebar, isSidebarOpen }) {
    const { user, logout } = (0, auth_context_1.useAuth)();
    return (<header className="sticky top-0 z-40 flex h-16 items-center gap-4 border-b border-gray-200 bg-white px-4 shadow-sm dark:border-gray-700 dark:bg-gray-900 sm:px-6">
      <button onClick={onToggleSidebar} className="inline-flex items-center justify-center rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200" aria-label={isSidebarOpen ? 'Cerrar menú' : 'Abrir menú'}>
        {isSidebarOpen ? (<lucide_react_1.X className="h-6 w-6"/>) : (<lucide_react_1.Menu className="h-6 w-6"/>)}
      </button>

      <div className="flex flex-1 items-center justify-end gap-4">
        {user && (<div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-medium text-white">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <span className="hidden text-sm font-medium text-gray-700 dark:text-gray-200 sm:inline">
              {user.name}
            </span>
          </div>)}

        <button_1.Button variant="ghost" size="sm" onClick={logout} className="flex items-center gap-2 text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400">
          <lucide_react_1.LogOut className="h-4 w-4"/>
          <span className="hidden sm:inline">Cerrar sesión</span>
        </button_1.Button>
      </div>
    </header>);
}
//# sourceMappingURL=navbar.js.map