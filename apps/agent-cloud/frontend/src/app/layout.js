"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.metadata = void 0;
exports.default = RootLayout;
const google_1 = require("next/font/google");
require("./globals.css");
const auth_context_1 = require("@/lib/auth-context");
const geistSans = (0, google_1.Geist)({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});
const geistMono = (0, google_1.Geist_Mono)({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});
exports.metadata = {
    title: "Agent-Cloud Dashboard",
    description: "Dashboard para gestionar agentes y proyectos de Agent-Cloud",
};
function RootLayout({ children, }) {
    return (<html lang="es">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <auth_context_1.AuthProvider>
          {children}
        </auth_context_1.AuthProvider>
      </body>
    </html>);
}
//# sourceMappingURL=layout.js.map