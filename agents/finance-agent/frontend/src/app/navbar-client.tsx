"use client";

import { usePathname, useRouter } from "next/navigation";
import { Navbar } from "@/components/Navbar";

/**
 * NavbarClient — a thin Client Component wrapper that bridges the
 * server-side layout with the client-side Navbar component.
 *
 * It reads the current pathname to determine the active nav item and
 * uses Next.js router for programmatic navigation.
 */
export function NavbarClient() {
  const pathname = usePathname();
  const router = useRouter();

  /* Derive the active nav item id from the current pathname.
     E.g. "/dashboard" → "dashboard", "/reports/123" → "reports" */
  const activeId = pathname?.split("/").filter(Boolean)[0] ?? "dashboard";

  return (
    <Navbar
      activeId={activeId}
      onNavigate={(item) => router.push(item.href)}
      logoSrc="/logo.svg"
      appTitle="Finance Agent"
    />
  );
}
