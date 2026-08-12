import { PortalShell } from "@/components/shell/portal-shell";

export default function CashierLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell role="CASHIER">{children}</PortalShell>;
}
