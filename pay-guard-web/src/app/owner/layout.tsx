import { PortalShell } from "@/components/shell/portal-shell";

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell role="BUSINESS_OWNER">{children}</PortalShell>;
}
