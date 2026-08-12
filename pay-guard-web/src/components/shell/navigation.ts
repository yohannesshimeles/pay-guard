import {
  Activity,
  Banknote,
  Bell,
  BookOpenCheck,
  Building2,
  CreditCard,
  Gauge,
  Landmark,
  ListChecks,
  ReceiptText,
  ScanLine,
  Settings,
  ShieldCheck,
  Users,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import type { WebRole } from "@/lib/api/contracts";

export type NavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export const roleNavigation: Record<WebRole, NavigationItem[]> = {
  PLATFORM_SUPER_ADMIN: [
    { label: "Overview", href: "/platform", icon: Gauge },
    { label: "Businesses", href: "/platform/businesses", icon: Building2 },
    { label: "Platform users", href: "/platform#users", icon: Users },
    { label: "Subscriptions", href: "/platform#subscriptions", icon: CreditCard },
    { label: "Verification", href: "/platform#verification", icon: ScanLine },
    { label: "Banks & API", href: "/platform#banks", icon: Landmark },
    { label: "Fraud & risk", href: "/platform#risk", icon: ShieldCheck },
    { label: "Monitoring", href: "/platform#monitoring", icon: Activity },
    { label: "Settings", href: "/platform#settings", icon: Settings },
  ],
  BUSINESS_OWNER: [
    { label: "Overview", href: "/owner", icon: Gauge },
    { label: "Business setup", href: "/owner/setup", icon: Building2 },
    { label: "Team", href: "/owner#team", icon: Users },
    { label: "Settlement", href: "/owner#settlement", icon: Landmark },
    { label: "Transactions", href: "/owner#transactions", icon: ReceiptText },
    { label: "Credits", href: "/owner#credits", icon: WalletCards },
    { label: "Subscription", href: "/owner#subscription", icon: CreditCard },
    { label: "Reports", href: "/owner#reports", icon: BookOpenCheck },
    { label: "Settings", href: "/owner#settings", icon: Settings },
  ],
  MANAGER: [
    { label: "Overview", href: "/manager", icon: Gauge },
    { label: "Verification", href: "/manager#verification", icon: ScanLine },
    { label: "Deposit review", href: "/manager#deposits", icon: Banknote },
    { label: "Financial actions", href: "/manager#financial", icon: ReceiptText },
    { label: "Reconciliation", href: "/manager#reconciliation", icon: ListChecks },
    { label: "Branch staff", href: "/manager#staff", icon: Users },
    { label: "Reports", href: "/manager#reports", icon: BookOpenCheck },
    { label: "Notifications", href: "/manager#notifications", icon: Bell },
  ],
  CASHIER: [
    { label: "Overview", href: "/cashier", icon: Gauge },
    { label: "Live verification", href: "/cashier#verification", icon: ScanLine },
    { label: "Manual deposit", href: "/cashier#manual-deposit", icon: Banknote },
    { label: "Cash operations", href: "/cashier#operations", icon: ReceiptText },
    { label: "Reconciliation", href: "/cashier#reconciliation", icon: ListChecks },
    { label: "Reports", href: "/cashier#reports", icon: BookOpenCheck },
    { label: "Notifications", href: "/cashier#notifications", icon: Bell },
    { label: "Settings", href: "/cashier#settings", icon: Settings },
  ],
};
