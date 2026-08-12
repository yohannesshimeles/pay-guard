import { PortalShell } from "@/components/shell/portal-shell";

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell role="PLATFORM_SUPER_ADMIN">{children}</PortalShell>;
}
