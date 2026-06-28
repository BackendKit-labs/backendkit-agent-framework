"use strict";
'use client';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Sidebar = Sidebar;
const react_1 = __importDefault(require("react"));
const link_1 = __importDefault(require("next/link"));
const navigation_1 = require("next/navigation");
const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: '📊' },
    { href: '/dashboard/projects', label: 'Proyectos', icon: '📁' },
    { href: '/dashboard/agents', label: 'Agentes', icon: '🤖' },
    { href: '/dashboard/director', label: 'Director', icon: '🎯' },
];
function Sidebar({ isOpen, onClose }) {
    const pathname = (0, navigation_1.usePathname)();
    return (<>
      
      {isOpen && (<div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onClose}/>)}

      
      <aside className={`fixed top-0 left-0 z-50 h-full w-64 bg-white border-r border-gray-200 transform transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static lg:z-auto ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <link_1.default href="/dashboard" className="text-xl font-bold text-primary-600">
            Agent-Cloud
          </link_1.default>
          <button onClick={onClose} className="lg:hidden p-2 rounded-md text-gray-500 hover:bg-gray-100">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <nav className="p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (<link_1.default key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-700 hover:bg-gray-100'}`} onClick={onClose}>
                <span className="text-lg">{item.icon}</span>
                {item.label}
              </link_1.default>);
        })}
        </nav>
      </aside>
    </>);
}
//# sourceMappingURL=sidebar.js.map