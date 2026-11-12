/**
 * Keep local browser E2E suites with synthetic Auth sessions isolated from real
 * Supabase projects. Register this broad route before any RPC-specific routes;
 * Playwright's later, more-specific handlers can then provide explicit fixtures.
 */
export async function mockSupabaseProjectRequests(page) {
  const requests = [];
  await page.route(/^https:\/\/[a-z0-9-]+\.supabase\.co\//, async route => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({ method: request.method(), path: url.pathname });
    const body = url.pathname.includes('/rest/v1/rpc/') ? '{}' : '[]';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body,
    });
  });
  return requests;
}

export async function mockAuthorizedSyncProfile(page) {
  await page.route('**/rest/v1/rpc/get_learning_sync_profile', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authorized: true }),
    });
  });
}
