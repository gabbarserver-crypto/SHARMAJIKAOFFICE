// src/lib/age.js
//
// Two related things live here:
//  1. calcAge / ageHighlightClass — highlight a DOB/age red under 18,
//     orange under 20 (as of today), used anywhere DOB is displayed.
//  2. minAgeForService / validateAgeForService — the minimum legal age
//     for a given service (Rickshaw/E-Cart: 20, LMV/MCWG: 18), used to
//     reject an out-of-range DOB when a dealer or staff member fills it
//     in on a new/edited application.

// Calendar-accurate age as of today (not just a year subtraction).
export function calcAge(dob) {
  if (!dob) return null;
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const hadBirthdayThisYear =
    today.getMonth() > birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

// Tailwind classes to highlight a DOB/age value. Red under 18, orange
// under 20 (but 18+), otherwise unstyled. Pass an ISO (yyyy-mm-dd) or any
// Date-parseable DOB string.
export function ageHighlightClass(dob) {
  const age = calcAge(dob);
  if (age === null) return "";
  if (age < 18) return "text-rose-600 font-semibold";
  if (age < 20) return "text-amber-600 font-semibold";
  return "";
}

// Minimum legal age for a service, based on its name. Rickshaw / E-Cart
// licences require 20; LMV and MCWG require 18. Returns null when the
// service doesn't match any known category — no age check is enforced
// in that case (so this never blocks services we don't have a rule for).
export function minAgeForService(service) {
  const name = `${service?.parent_service || ""} ${service?.short_name || ""}`.toLowerCase();
  if (/rickshaw|e-?cart|\bcart\b/.test(name)) return 20;
  if (/\blmv\b|\bmcwg\b/.test(name)) return 18;
  return null;
}

// Validates a DOB (ISO yyyy-mm-dd) against a service's minimum age.
// Returns an error message string if invalid, or null if it's fine (or
// not checkable — missing DOB, unparseable date, or no rule for this
// service). Meant to be called right before submit.
export function validateAgeForService(dobIso, service) {
  if (!dobIso) return null;
  const age = calcAge(dobIso);
  if (age === null) return "Not a valid date of birth";
  const minAge = minAgeForService(service);
  if (minAge === null) return null;
  if (age < minAge) {
    const label = service?.short_name || service?.parent_service || "this service";
    return `Not valid age — ${label} requires a minimum age of ${minAge}. This applicant is ${age}.`;
  }
  return null;
}
