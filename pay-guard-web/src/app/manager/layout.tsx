import { PortalShell } from "@/components/shell/portal-shell";

export default function ManagerLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell role="MANAGER">{children}</PortalShell>;
}
