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
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = DashboardLayout;
const react_1 = __importStar(require("react"));
const auth_context_1 = require("@/lib/auth-context");
const navigation_1 = require("next/navigation");
const sidebar_1 = require("@/components/layout/sidebar");
const header_1 = require("@/components/layout/header");
function DashboardLayout({ children, }) {
    const { isAuthenticated, isLoading } = (0, auth_context_1.useAuth)();
    const router = (0, navigation_1.useRouter)();
    const [sidebarOpen, setSidebarOpen] = (0, react_1.useState)(false);
    react_1.default.useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            router.push('/login');
        }
    }, [isLoading, isAuthenticated, router]);
    if (isLoading) {
        return (<div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"/>
      </div>);
    }
    if (!isAuthenticated) {
        return null;
    }
    return (<div className="min-h-screen bg-gray-50">
      <sidebar_1.Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}/>
      
      <div className="lg:ml-64">
        <header_1.Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)}/>
        
        <main className="p-6">
          {children}
        </main>
      </div>
    </div>);
}
//# sourceMappingURL=layout.js.map