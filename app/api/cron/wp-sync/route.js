import { syncFromWordPress } from "../../../../lib/wpSync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request) {
  const secret = process.env.INBOX_CRON_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  const url = new URL(request.url);
  const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return [bearer, request.headers.get("x-cron-secret"), url.searchParams.get("secret")].includes(secret);
}

// Nightly (pg_cron → this URL). ?dry=1 reports what would change without writing.
async function handle(request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const dryRun = new URL(request.url).searchParams.get("dry") === "1";
  try {
    return Response.json({ ok: true, dryRun, ...(await syncFromWordPress({ dryRun })) });
  } catch (err) {
    console.error("[wp-sync]", err);
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
