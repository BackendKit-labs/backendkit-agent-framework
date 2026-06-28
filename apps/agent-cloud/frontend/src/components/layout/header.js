"use strict";
'use client';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Header = Header;
const react_1 = __importDefault(require("react"));
const auth_context_1 = require("@/lib/auth-context");
const button_1 = require("@/components/ui/button");
function Header({ onMenuToggle }) {
    const { user, logout } = (0, auth_context_1.useAuth)();
    return (<header className="sticky top-0 z-30 bg-white border-b border-gray-200">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={onMenuToggle} className="lg:hidden p-2 rounded-md text-gray-500 hover:bg-gray-100">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16"/>
          </svg>
        </button>

        <div className="flex items-center gap-4 ml-auto">
          {user && (<span className="text-sm text-gray-700">
              {user.name}
            </span>)}
          <button_1.Button variant="ghost" size="sm" onClick={logout}>
            Cerrar sesión
          </button_1.Button>
        </div>
      </div>
    </header>);
}
//# sourceMappingURL=header.js.map