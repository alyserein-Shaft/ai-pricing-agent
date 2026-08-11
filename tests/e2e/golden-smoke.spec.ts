import { expect, test } from "playwright/test";

test("@golden @golden-smoke creates a durable project and restores it after refresh", async ({ page, request }) => {
  const session = await request.get("/api/auth/session");
  expect(session.ok()).toBeTruthy();
  const identity = await session.json();
  expect(identity.user.id).toBe("golden-e2e-user");
  expect(identity.defaultOrganizationId).toBe("golden-e2e-organization");
  expect(
    identity.organizations.some(
      (organization: { id: string }) =>
        organization.id === "golden-e2e-organization",
    ),
  ).toBeTruthy();

  await page.goto("/");
  await expect(page.getByText("Golden E2E User")).toBeVisible();

  const created = await request.post("/api/projects", {
    data: {
      name: "Golden E2E Smoke Project",
      client: "Internal Validation",
      reference: "GOLDEN-SMOKE-001",
      system: "Fire Alarm",
      status: "Draft",
    },
  });
  expect(created.status()).toBe(201);
  const payload = await created.json();
  const projectId = payload.project.id;
  expect(projectId).toMatch(/^project_/);

  await page.goto(`/?project=${encodeURIComponent(projectId)}&workspace=Overview`);
  await expect(page.getByRole("heading", { name: "Golden E2E Smoke Project" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Golden E2E Smoke Project" })).toBeVisible();

  const persisted = await request.get(`/api/projects/${encodeURIComponent(projectId)}/dashboard`);
  expect(persisted.ok()).toBeTruthy();
  const dashboard = await persisted.json();
  expect(dashboard.project.id).toBe(projectId);
  expect(dashboard.project.organizationId).toBe("golden-e2e-organization");
});
