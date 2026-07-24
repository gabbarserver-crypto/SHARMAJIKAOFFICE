// api/_lib/pccClient.js
// Shared by the PCC status serverless functions below. Not itself a route —
// files/folders starting with "_" are ignored by Vercel's file-based routing.
//
// This replaces server/index.js's PCC proxy for Vercel deployments: instead
// of needing a separately-hosted Express server, these run as Vercel
// Serverless Functions right alongside the frontend.
import axios from "axios";
import { createClient } from "@supabase/supabase-js";

const DELHI_PCC_BASE_URL =
  process.env.DELHI_PCC_BASE_URL || "https://pcccvr.delhipolice.gov.in/api/PccForm";

const delhiClient = axios.create({
  baseURL: DELHI_PCC_BASE_URL,
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

export const supabaseSync =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

// Delhi Police's portal expects the FULL application number including the
// "DLSB-PCC/" prefix. Mirrors normalizePccApplicationNumber() in
// PCCStatusCheckModal.jsx.
export function normalizePccApplicationNumber(pccNo) {
  if (!pccNo) return pccNo;
  const trimmed = pccNo.trim();
  return /^DLSB-PCC\//i.test(trimmed) ? trimmed : `DLSB-PCC/${trimmed}`;
}

function stripKinPrefix(name) {
  if (!name) return name;
  return name.replace(/^\s*(s\/o|w\/o|d\/o|c\/o)[\s:.]*?/i, "").trim();
}

/**
 * Mirrors exactly what the Delhi Police portal's own public "Track
 * Application" page calls:
 *   1. POST /search-pcc-application    { applicationNumber, applicantName, guardianName }
 *   2. POST /get-pcc-applicant-details { applicationID }   <- capital ID
 *   3. POST /get-pcc-application-status { applicationId }  <- lowercase d
 */
export async function lookupPccStatus({ applicationNumber, applicantName, guardianName }) {
  const searchResult = await delhiClient.post("/search-pcc-application", {
    applicationNumber,
    applicantName,
    guardianName,
  });

  const application = searchResult.data?.data?.[0] || null;
  if (!application?.applicationID) {
    return { success: false, stage: "search", raw: searchResult.data };
  }

  const id = String(application.applicationID);

  const [detailsResult, statusResult] = await Promise.allSettled([
    delhiClient.post("/get-pcc-applicant-details", { applicationID: id }),
    delhiClient.post("/get-pcc-application-status", { applicationId: id }),
  ]);

  return {
    success: true,
    application,
    details: detailsResult.status === "fulfilled" ? detailsResult.value.data?.data || null : null,
    status: statusResult.status === "fulfilled" ? statusResult.value.data?.data || null : null,
    statusError: statusResult.status === "rejected"
      ? { message: statusResult.reason.message, body: statusResult.reason.response?.data || null }
      : null,
  };
}

// Delhi Police's timeline "stage" values (Pending, Assigned, Field Verified,
// Approved, Verified, Certificate Issued) are more granular than the
// dropdown in Applications.jsx (Under Verification, Certificate Issued,
// Rejected, Police Case). Anything before "Certificate Issued" maps to
// "Under Verification" — there's no confirmed API signal yet for Rejected /
// Police Case, so those two stay manual until we see a real example.
export function mapStageToDropdownStatus(status) {
  const timeline = status?.timeline || [];
  const stages = new Set(timeline.map((t) => t.stage));
  if (stages.has("Certificate Issued")) return "Certificate Issued";
  if (timeline.length > 0) return "Under Verification";
  return null; // no timeline data back — don't overwrite whatever's there
}

/**
 * Re-checks every application that has a PCC number and isn't already in a
 * finished/manual-only state, and writes the current stage back into
 * applications.pcc_status.
 */
export async function runPccAutoSync() {
  if (!supabaseSync) {
    console.error("PCC auto-sync skipped: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
    return { checked: 0, updated: 0, errors: ["Supabase not configured"] };
  }

  const { data: rows, error: fetchError } = await supabaseSync
    .from("applications")
    .select("id, pcc_no, applicant_name, father_husband_name, pcc_status")
    .not("pcc_no", "is", null)
    .not("pcc_status", "in", '("Certificate Issued","Rejected","Police Case")');

  if (fetchError) {
    console.error("PCC auto-sync: failed to load applications", fetchError.message);
    return { checked: 0, updated: 0, errors: [fetchError.message] };
  }

  let updated = 0;
  const errors = [];

  for (const row of rows || []) {
    const applicationNumber = normalizePccApplicationNumber(row.pcc_no);
    const guardianName = stripKinPrefix(row.father_husband_name || "");

    try {
      const result = await lookupPccStatus({
        applicationNumber,
        applicantName: row.applicant_name,
        guardianName,
      });

      if (!result.success) continue; // not found on portal this round, leave as-is

      const newStatus = mapStageToDropdownStatus(result.status);
      if (newStatus && newStatus !== row.pcc_status) {
        const { error: updateError } = await supabaseSync
          .from("applications")
          .update({ pcc_status: newStatus })
          .eq("id", row.id);
        if (updateError) {
          errors.push(`row ${row.id}: ${updateError.message}`);
        } else {
          updated += 1;
        }
      }
    } catch (err) {
      errors.push(`row ${row.id} (${row.pcc_no}): ${err.message}`);
    }

    // Small delay between requests so we don't hammer the portal.
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`PCC auto-sync: checked ${rows?.length || 0}, updated ${updated}, errors ${errors.length}`);
  return { checked: rows?.length || 0, updated, errors };
}
