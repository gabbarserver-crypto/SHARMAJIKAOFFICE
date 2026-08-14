// src/lib/aadhaarQr.js
//
// Reads the QR code printed on an Aadhaar card/e-Aadhaar PDF page image and
// pulls out Name, DOB (or year of birth), Father/Guardian name, and Address
// — used to prefill the New Application form instead of the dealer typing
// it all by hand.
//
// HOW THIS WORKS, AND ITS REAL LIMITS (please read before changing field
// mapping):
//
// Uses the browser's built-in `BarcodeDetector` API to read the QR — no
// external QR/OCR library needed, since it ships in Chrome/Edge/Android
// WebView already (i.e. exactly what this app runs in). If it's missing
// (older Safari, some desktop browsers), scanning simply isn't offered —
// see isAadhaarQrScanSupported().
//
// Aadhaar cards use TWO different QR formats depending on when/how the
// card was printed:
//   1. The OLDER plain-text QR — a single "|"-delimited UTF-8 string
//      (name, gender, year-of-birth, care-of/guardian name, address
//      pieces, then a photo blob). This is what we can actually read here.
//   2. The NEWER "Secure QR" — zlib-COMPRESSED BINARY data. The browser's
//      BarcodeDetector always hands back a QR's contents as a text string
//      (UTF-8 decoded), and UTF-8-decoding arbitrary compressed binary is
//      lossy — bytes that aren't valid UTF-8 get silently replaced/dropped.
//      There is no way to get the raw bytes back out of that string, so
//      this compressed format CANNOT be reliably decoded through this
//      browser API. Trying anyway risks silently producing WRONG data on
//      an official RTO application, which is worse than not autofilling
//      at all — so scanAadhaarQr() deliberately detects this case and
//      fails with a clear "couldn't read this QR" message rather than
//      guessing.
//
// The old format's exact field order isn't officially published by
// UIDAI — this mapping is based on widely-referenced community
// documentation, not an official spec. It's worked correctly on every
// sample QR tested during development, but if it comes back wrong on a
// real card, the fix is almost always just reordering FIELD_ORDER below —
// paste me the (harmless, non-secret) pipe-delimited raw text and I'll
// correct it.
const FIELD_ORDER = [
  "referenceId", // Aadhaar reference no. / last digits — often blank on masked cards
  "name",
  "gender",
  "yob", // year of birth only — old format doesn't carry the full DOB
  "careOf", // "S/O: ...", "D/O: ...", "W/O: ...", "C/O: ..." — father/husband/guardian name
  "district",
  "landmark",
  "house",
  "location",
  "pincode",
  "postOffice",
  "state",
];

export function isAadhaarQrScanSupported() {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

// Loads an image file into an ImageBitmap for BarcodeDetector to scan.
async function fileToImageBitmap(file) {
  return await createImageBitmap(file);
}

// Strips a "S/O: X", "D/O: X", "W/O: X", "C/O: X" (or without the colon)
// prefix off Aadhaar's careOf field, returning just the name.
function extractGuardianName(careOf) {
  if (!careOf) return "";
  const m = careOf.match(/^\s*(?:S\/O|D\/O|W\/O|C\/O)[:.]?\s*(.+)$/i);
  return (m ? m[1] : careOf).trim();
}

function buildAddress(fields) {
  return [fields.house, fields.landmark, fields.location, fields.vtc, fields.postOffice, fields.district, fields.subDistrict, fields.state, fields.pincode]
    .filter(Boolean)
    .join(", ");
}

// Throws with a message meant to be shown directly to the dealer — keep
// these short and actionable, not technical.
export async function scanAadhaarQr(file) {
  if (!isAadhaarQrScanSupported()) {
    throw new Error("QR scanning isn't supported in this browser — please fill the details manually.");
  }

  const bitmap = await fileToImageBitmap(file);
  const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
  const results = await detector.detect(bitmap);
  if (!results.length) {
    throw new Error("No QR code found in this image. Make sure the QR on the Aadhaar is clearly visible and try again.");
  }

  const raw = results[0].rawValue || "";

  // A successfully-decoded old-format QR is clean, printable pipe-delimited
  // text. If it's mostly non-printable characters, that's the tell-tale
  // sign of a newer compressed Secure QR that came through mangled — bail
  // out with a clear message rather than parsing garbage.
  const printableRatio = raw.length ? (raw.match(/[\x20-\x7E]/g) || []).length / raw.length : 0;
  if (printableRatio < 0.85 || !raw.includes("|")) {
    throw new Error(
      "This Aadhaar uses a newer QR format this app can't read yet — please fill the details manually."
    );
  }

  const parts = raw.split("|");
  if (parts.length < 6) {
    throw new Error("Couldn't recognize this QR's format — please fill the details manually.");
  }

  const fields = {};
  FIELD_ORDER.forEach((key, i) => { fields[key] = (parts[i] || "").trim(); });

  return {
    name: fields.name || "",
    fatherHusbandName: extractGuardianName(fields.careOf),
    yearOfBirth: /^\d{4}$/.test(fields.yob) ? fields.yob : "",
    gender: fields.gender || "",
    address: buildAddress(fields),
    pincode: fields.pincode || "",
    raw, // kept for debugging — not shown to the dealer
  };
}
