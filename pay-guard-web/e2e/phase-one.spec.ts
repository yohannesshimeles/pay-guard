import { expect, test } from "@playwright/test";

test("login is responsive and exposes validation", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to PayGuard" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page.getByText("Enter your email or username.")).toBeVisible();
  await expect(page.getByText("Password must contain at least 8 characters.")).toBeVisible();
});

test("unauthenticated portal access returns to sign in", async ({ page }) => {
  await page.goto("/owner");
  await expect(page).toHaveURL(/\/login\?reason=session-required/);
});

test("role mismatch is denied before protected content renders", async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: "pg_role",
      value: "CASHIER",
      url: "http://127.0.0.1:3100",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/platform");
  await expect(page).toHaveURL(/\/access-denied/);
  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
});

for (const scenario of [
  {
    role: "PLATFORM_SUPER_ADMIN",
    path: "/platform",
    heading: "Platform overview",
  },
  { role: "BUSINESS_OWNER", path: "/owner", heading: "Business overview" },
  { role: "MANAGER", path: "/manager", heading: "Manager overview" },
  { role: "CASHIER", path: "/cashier", heading: "Cashier overview" },
] as const) {
  test(`${scenario.role} lands in the correct portal`, async ({ context, page }) => {
    await context.addCookies([
      {
        name: "pg_role",
        value: scenario.role,
        url: "http://127.0.0.1:3100",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.route("**/api/session/me", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          message: "ok",
          correlationId: "e2e",
          data: {
            userId: "test-user",
            role: scenario.role,
            businessIds:
              scenario.role === "PLATFORM_SUPER_ADMIN" ? [] : ["business-1"],
            branchId:
              scenario.role === "MANAGER" || scenario.role === "CASHIER"
                ? "branch-1"
                : undefined,
          },
        }),
      }),
    );
    await page.route("**/api/scope/**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          message: "ok",
          correlationId: "e2e",
          data: [],
        }),
      }),
    );
    await page.goto(scenario.path);
    await expect(page.getByRole("heading", { name: scenario.heading })).toBeVisible();
  });
}

test("public business registration validates required data", async ({ page }) => {
  await page.goto("/register-business");
  await expect(page.getByRole("heading", { name: "Register for PayGuard" })).toBeVisible();
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page.getByLabel("Business name")).toBeFocused();
});

test("platform business review renders backend-scoped applications", async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: "pg_role",
      value: "PLATFORM_SUPER_ADMIN",
      url: "http://127.0.0.1:3100",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.route("**/api/session/me", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        message: "ok",
        correlationId: "e2e",
        data: {
          userId: "admin",
          role: "PLATFORM_SUPER_ADMIN",
          businessIds: [],
        },
      }),
    }),
  );
  await page.route("**/api/backend/businesses", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        message: "ok",
        correlationId: "e2e",
        data: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Sample Business",
            registrationNumber: "REG-1",
            contactEmail: "owner@example.test",
            status: "PENDING",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    }),
  );
  await page.goto("/platform/businesses");
  await expect(page.getByText("Sample Business")).toBeVisible();
  await expect(page.getByText("PENDING")).toBeVisible();
});
