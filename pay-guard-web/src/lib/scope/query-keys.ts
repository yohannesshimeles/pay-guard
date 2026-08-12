export function scopedQueryKey(
  resource: string,
  businessId?: string,
  branchId?: string,
) {
  return ["scoped", resource, businessId ?? "none", branchId ?? "none"] as const;
}
