import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/* ─── Fonts ─────────────────────────────────────────────────────────── */

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

/* ─── Metadata ──────────────────────────────────────────────────────── */

export const metadata: Metadata = {
  title: {
    default: "Finance Agent — Dashboard Financiero",
    template: "%s | Finance Agent",
  },
  description:
    "Panel de control financiero con KPIs, reportes automáticos y análisis de datos contables para empresas colombianas.",
  keywords: [
    "finanzas",
    "dashboard",
    "contabilidad",
    "KPIs",
    "reportes financieros",
    "Colombia",
    "NIIF",
  ],
  authors: [{ name: "Finance Agent" }],
  creator: "Finance Agent",
  publisher: "Finance Agent",
  robots: {
    index: false,
    follow: false,
  },
  icons: {
    icon: "/logo.svg",
    apple: "/logo.svg",
  },
  openGraph: {
    title: "Finance Agent — Dashboard Financiero",
    description:
      "Panel de control financiero con KPIs, reportes automáticos y análisis de datos contables.",
    siteName: "Finance Agent",
    type: "website",
    locale: "es_CO",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1a237e",
};

/* ─── Root Layout ───────────────────────────────────────────────────── */

interface RootLayoutProps {
  children: React.ReactNode;
}

/**
 * Root layout — wraps every page with the Inter font, the sidebar navbar,
 * and a main content area.
 *
 * The Navbar is rendered on the server (it's a Client component but can be
 * imported here). The main content area uses `min-h-screen` and accounts
 * for the sidebar width on large screens via `lg:pl-64`.
 */
export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html
      lang="es-CO"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-gray-50 font-sans text-gray-900 antialiased">
        {/* Sidebar navigation — rendered as a Client component */}
        <NavbarWrapper />

        {/* Main content area */}
        <main
          id="main-content"
          className="min-h-screen transition-all duration-200 lg:pl-64"
          role="main"
          aria-label="Contenido principal"
        >
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}

/* ─── Navbar Wrapper ────────────────────────────────────────────────── */

/**
 * A thin wrapper that imports the Client-side Navbar and wires it to
 * Next.js navigation. This keeps the layout file as a Server Component
 * while the Navbar remains a Client Component.
 */
function NavbarWrapper() {
  return <NavbarClient />;
}

/* We use a dynamic import approach: the Navbar is a Client Component,
   so we import it in a separate client wrapper file. */
import { NavbarClient } from "./navbar-client";
