export const roles = [
  "PLATFORM_SUPER_ADMIN",
  "BUSINESS_OWNER",
  "MANAGER",
  "CASHIER",
] as const;

export type WebRole = (typeof roles)[number];

export type Principal = {
  userId: string;
  role: WebRole;
  businessIds: string[];
  branchId?: string;
  deviceId?: string;
};

export type ApiSuccess<T> = {
  success: true;
  message: string;
  data: T;
  correlationId: string;
};

export type ApiFailure = {
  success: false;
  message: string;
  data: null;
  error: {
    code: string;
    details?: string[];
  };
  correlationId: string;
};

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export type TokenPair = {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
  principal?: Principal;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "REQUEST_FAILED",
    readonly correlationId?: string,
    readonly details?: string[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function readEnvelope<T>(response: Response): Promise<T> {
  const envelope = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !envelope.success) {
    const failure = envelope as ApiFailure;
    throw new ApiError(
      failure.message || "Request failed",
      response.status,
      failure.error?.code,
      failure.correlationId,
      failure.error?.details,
    );
  }
  return envelope.data;
}
