// api/pcc-status/sync-all.js
// Vercel Serverless Function — re-checks every open PCC application and
// updates pcc_status. Triggered on a schedule by Vercel Cron (see
// vercel.json), and protected by CRON_SECRET so no one else can call it.
//
// Required Vercel env vars (Project Settings → Environment Variables):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   CRON_SECRET            (any random string you generate — Vercel Cron
//                            automatically sends it as a Bearer token)
//
// NOTE ON PLAN LIMITS: Vercel's Hobby (free) plan only allows cron jobs to
// run once per day, not every 2 hours — that restriction is Vercel's, not
// something this code can get around. If you're on Hobby, leave the
// schedule in vercel.json as-is but also set up a free external scheduler
// (e.g. cron-job.org) to POST to this same URL every 2 hours with the
// header:  Authorization: Bearer <your CRON_SECRET>
import { runPccAutoSync } from "../_lib/pccClient.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const isVercelCron = req.headers["x-vercel-cron"] !== undefined;
  const authHeader = req.headers.authorization || "";
  const providedSecret = authHeader.replace(/^Bearer\s+/i, "");

  if (!isVercelCron && providedSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await runPccAutoSync();
    res.json(result);
  } catch (err) {
    console.error("PCC auto-sync crashed:", err.message);
    res.status(500).json({ error: err.message });
  }
}
