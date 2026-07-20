// src/lib/nextService.js
// Shared by the admin Applications page and the Dealer Portal: decides
// whether an application is eligible to "Book Appointment" into its
// configured next service (Masters > Service > Next Service), and builds
// the payload for the new draft.
import { supabase } from "./supabase";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// `convertedSourceIds` is a Set of every application's source_application_id
// already in use (i.e. "this application has already been converted") —
// build it once from whatever list of applications the page already has
// loaded, rather than an extra query per row.
export function isEligibleForAppointment(app, convertedSourceIds) {
  if (app.status !== "Completed") return false;
  if (!app.services?.next_service_id) return false;
  if (!app.completed_at) return false;
  if (convertedSourceIds.has(app.id)) return false;
  const waitDays = app.services?.next_service_wait_days ?? 30;
  const completedAt = new Date(app.completed_at).getTime();
  return Date.now() - completedAt >= waitDays * MS_PER_DAY;
}

export function daysSinceCompleted(app) {
  if (!app.completed_at) return null;
  return Math.floor((Date.now() - new Date(app.completed_at).getTime()) / MS_PER_DAY);
}

// Builds the insert payload for the new draft application, copying the
// applicant over from the source and pointing back at it. Also seeds
// Service Answers that the new application will need but that were already
// established on the source — e.g. a Driving Licence application needs the
// Learner No from the Learner's Licence, and a PCC No already on file
// usually carries forward too.
export function buildAppointmentDraft(sourceApp, { serviceId, slotTime, draftCode }) {
  const serviceAnswers = {};
  const learnerNo = sourceApp.ll_dl_no || sourceApp.service_answers?.["Learner No"];
  if (learnerNo) serviceAnswers["Learner No"] = learnerNo;
  const pccNo = sourceApp.pcc_no || sourceApp.service_answers?.["PCC No"];
  if (pccNo) serviceAnswers["PCC No"] = pccNo;

  return {
    draft_code: draftCode,
    dealer_id: sourceApp.dealer_id,
    service_id: serviceId,
    applicant_name: sourceApp.applicant_name,
    father_husband_name: sourceApp.father_husband_name || null,
    date_of_birth: sourceApp.date_of_birth || null,
    mobile: sourceApp.mobile || null,
    address: sourceApp.address || null,
    slot_time: slotTime || null,
    status: "Draft Submitted",
    source_application_id: sourceApp.id,
    service_answers: Object.keys(serviceAnswers).length ? serviceAnswers : null,
  };
}

// Called after the new draft's own required-document rows have already been
// created (from the new service's Required Documents list in Masters). For
// any document that's common to both applications BY NAME — typically
// Aadhaar Card, Photo, Signature — copies the already-uploaded file over
// instead of making the applicant re-upload identity documents that haven't
// changed between, say, the Learner's and Driving Licence applications.
export async function copyForwardDocuments(sourceAppId, newAppId) {
  const { data: sourceDocs } = await supabase
    .from("application_documents")
    .select("name, file_url, status")
    .eq("application_id", sourceAppId)
    .not("file_url", "is", null);
  if (!sourceDocs?.length) return;

  const { data: newDocs } = await supabase
    .from("application_documents")
    .select("id, name")
    .eq("application_id", newAppId);
  if (!newDocs?.length) return;

  const byName = Object.fromEntries(sourceDocs.map((d) => [d.name.trim().toLowerCase(), d]));
  await Promise.all(
    newDocs
      .filter((d) => byName[d.name.trim().toLowerCase()])
      .map((d) => {
        const match = byName[d.name.trim().toLowerCase()];
        return supabase
          .from("application_documents")
          .update({ file_url: match.file_url, status: match.status || "Pending" })
          .eq("id", d.id);
      })
  );
}
