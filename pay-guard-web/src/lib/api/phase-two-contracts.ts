export type BusinessStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED";

export type Business = {
  id: string;
  name: string;
  registrationNumber: string | null;
  contactEmail: string | null;
  status: BusinessStatus;
  createdAt: string;
  updatedAt: string;
};

export type Branch = {
  id: string;
  businessId: string;
  name: string;
  code: string | null;
  address: string | null;
  status: string;
  settings: {
    timezone: string;
    currencyCode: string;
    verificationTimeToleranceMinutes: number;
  };
  createdAt: string;
};

export type StaffRole = "MANAGER" | "CASHIER" | "WAITER";

export type StaffMember = {
  id: string;
  email: string | null;
  phone: string | null;
  status: "ACTIVE" | "INACTIVE" | "REMOVED";
  role: StaffRole;
  branchId: string;
  createdAt: string;
  removedAt?: string | null;
  removalReason?: string | null;
};

export type Bank = {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
};

export type SettlementAccount = {
  id: string;
  bank: { id: string; code: string; name: string };
  accountMask: string;
  accountSuffix: string;
  label: string | null;
  active: boolean;
  createdAt: string;
};
