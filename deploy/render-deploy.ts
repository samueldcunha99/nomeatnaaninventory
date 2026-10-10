// A hook accepts a deployment; it does not prove the service has finished deploying.
export {};
const hook = process.env.RENDER_DEPLOY_HOOK_URL?.trim();
const commit = process.env.DEPLOY_COMMIT?.trim();
if (!hook || !commit || !/^[a-f0-9]{40}$/.test(commit)) {
  throw new Error('RENDER_DEPLOY_HOOK_URL and a full DEPLOY_COMMIT SHA are required.');
}
try {
  const url = new URL(hook);
  if (url.protocol !== 'https:' || url.hostname !== 'api.render.com' || !url.pathname.startsWith('/deploy/')) {
    throw new Error('Use the HTTPS deploy hook from Render service Settings.');
  }
  url.searchParams.set('ref', commit);
  const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Render rejected the deployment request (HTTP ${response.status}).`);
  console.log(`Render accepted deployment of ${commit}. Check the service Events page for completion.`);
} catch (error) {
  // Fetch errors can include the secret URL. Never print their raw cause or response.
  console.error(error instanceof Error && error.message.startsWith('Render rejected')
    ? error.message : 'Render deployment request failed. Check connectivity and the deploy hook secret.');
  process.exitCode = 1;
}
