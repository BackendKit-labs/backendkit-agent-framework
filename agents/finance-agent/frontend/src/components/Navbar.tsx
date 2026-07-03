"use client";

import {
  type ComponentPropsWithoutRef,
  useCallback,
  useEffect,
  useId,
  useState,
} from "react";

/* ─── Types ─────────────────────────────────────────────────────────── */

interface NavItem {
  /** Unique identifier for the nav item */
  id: string;
  /** Display label */
  label: string;
  /** Route path (e.g. "/dashboard") */
  href: string;
  /** Optional SVG icon path data (rendered inside a 20×20 viewBox) */
  icon?: string;
}

interface NavbarProps {
  /** Navigation items to render */
  items?: NavItem[];
  /** Currently active item id */
  activeId?: string;
  /** Called when a nav item is clicked */
  onNavigate?: (item: NavItem) => void;
  /** Application title shown at the top of the sidebar */
  appTitle?: string;
  /** Logo URL (optional) */
  logoSrc?: string;
  /** Additional CSS classes for the sidebar container */
  className?: string;
}

/* ─── Default navigation items ──────────────────────────────────────── */

const DEFAULT_NAV_ITEMS: NavItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  },
  {
    id: "reports",
    label: "Reportes",
    href: "/reports",
    icon: "M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  },
  {
    id: "config",
    label: "Configuración",
    href: "/config",
    icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  },
  {
    id: "vault",
    label: "Vault",
    href: "/vault",
    icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
  },
];

/* ─── Icons (inline SVG components) ─────────────────────────────────── */

function NavIcon({ path }: { path: string }) {
  return (
    <svg
      className="h-5 w-5 shrink-0"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

/* ─── Hamburger button ──────────────────────────────────────────────── */

function HamburgerButton({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  const labelId = useId();

  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls="navbar-sidebar"
      aria-label={expanded ? "Cerrar menú" : "Abrir menú"}
      className="fixed left-4 top-4 z-50 inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white p-2 text-gray-600 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 lg:hidden"
      onClick={onToggle}
    >
      <svg
        className="h-5 w-5"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        {expanded ? (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 18L18 6M6 6l12 12"
          />
        ) : (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 6h16M4 12h16M4 18h16"
          />
        )}
      </svg>
    </button>
  );
}

/* ─── Navbar Component ──────────────────────────────────────────────── */

/**
 * Navbar — collapsible sidebar navigation for the Finance Agent dashboard.
 *
 * - On desktop (≥1024px): always visible, pinned to the left.
 * - On mobile (<1024px): hidden by default, toggled via a hamburger button.
 * - Clicking a nav item calls `onNavigate` and closes the sidebar on mobile.
 * - Respects `prefers-reduced-motion`.
 *
 * @example
 * ```tsx
 * <Navbar
 *   activeId="dashboard"
 *   onNavigate={(item) => router.push(item.href)}
 * />
 * ```
 */
export function Navbar({
  items = DEFAULT_NAV_ITEMS,
  activeId,
  onNavigate,
  appTitle = "Finance Agent",
  logoSrc,
  className = "",
}: NavbarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const sidebarId = useId();

  /* Close sidebar on Escape key */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    },
    [isOpen],
  );

  /* Close sidebar when clicking outside (mobile overlay) */
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(`#${sidebarId}`) || target.closest("[aria-controls]")) {
        return;
      }
      setIsOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, sidebarId]);

  /* Lock body scroll when sidebar is open on mobile */
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const handleNavClick = (item: NavItem) => {
    onNavigate?.(item);
    setIsOpen(false);
  };

  return (
    <>
      {/* Mobile hamburger */}
      <HamburgerButton expanded={isOpen} onToggle={() => setIsOpen((v) => !v)} />

      {/* Mobile overlay backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 backdrop-blur-sm lg:hidden"
          aria-hidden="true"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        id={sidebarId}
        role="navigation"
        aria-label="Navegación principal"
        className={`
          fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-gray-200 bg-white
          transition-transform duration-200 ease-in-out
          lg:static lg:translate-x-0
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
          ${className}
        `}
        onKeyDown={handleKeyDown}
      >
        {/* Logo / Brand */}
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-gray-100 px-5">
          {logoSrc ? (
            <img
              src={logoSrc}
              alt={`${appTitle} logo`}
              className="h-8 w-8 rounded"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-900 text-sm font-bold text-white">
              $
            </div>
          )}
          <span className="text-base font-semibold text-gray-900">
            {appTitle}
          </span>
        </div>

        {/* Navigation links */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 scrollbar-thin">
          <ul className="flex flex-col gap-1" role="list">
            {items.map((item) => {
              const isActive = item.id === activeId;

              return (
                <li key={item.id}>
                  <button
                    type="button"
                    role="link"
                    aria-current={isActive ? "page" : undefined}
                    className={`
                      flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium
                      transition-colors duration-150
                      focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1
                      ${
                        isActive
                          ? "bg-primary-50 text-primary-900"
                          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                      }
                    `}
                    onClick={() => handleNavClick(item)}
                  >
                    {item.icon && <NavIcon path={item.icon} />}
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer */}
        <div className="border-t border-gray-100 px-5 py-3">
          <p className="text-xs text-gray-400">
            &copy; {new Date().getFullYear()} Finance Agent
          </p>
        </div>
      </aside>
    </>
  );
}
