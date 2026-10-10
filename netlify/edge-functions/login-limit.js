/**
 * Netlify applies this limit outside the ephemeral Next.js function instances.
 * The handler does not read credentials or consume a Server Action request body.
 * All POST paths are covered because Server Action IDs can be invoked on other pages.
 * See https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/
 * The existing failed-account counters remain a second, per-instance check.
 */
export default function loginLimit() {}

export const config = {
  path: "/*",
  method: "POST",
  rateLimit: {
    windowLimit: 30,
    windowSize: 180,
    aggregateBy: ["ip", "domain"],
  },
};
