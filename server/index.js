// server/index.js
//
// Proxies calls to the Delhi Police PCC portal so the React app (running in the
// browser) never has to call pcccvr.delhipolice.gov.in directly — that request
// would be blocked by the portal's CORS policy if it came straight from the browser.
//
// Run:
//   cd server
//   npm install
//   npm start           (defaults to http://localhost:5000)

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const DELHI_PCC_BASE_URL =
  process.env.DELHI_PCC_BASE_URL || "https://pcccvr.delhipolice.gov.in/api/PccForm";

const delhiClient = axios.create({
  baseURL: DELHI_PCC_BASE_URL,
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

/**
 * STEP 1 — Search for the application to get its applicationID.
 *
 * Body: { applicationNumber, applicantName, guardianName }
 * Forwards as-is to Delhi Police's search-pcc-application endpoint and
 * returns their response unchanged.
 */
app.post("/api/pcc-status/search", async (req, res) => {
  const { applicationNumber, applicantName, guardianName } = req.body || {};
  if (!applicationNumber || !applicantName) {
    return res.status(400).json({ success: false, error: "applicationNumber and applicantName are required" });
  }

  try {
    const result = await delhiClient.post("/search-pcc-application", {
      applicationNumber,
      applicantName,
      guardianName,
    });
    res.json(result.data);
  } catch (err) {
    console.error("PCC search failed:", err.message);
    res.status(err.response?.status || 500).json({
      success: false,
      error: err.message,
      details: err.response?.data,
    });
  }
});

/**
 * "Fetch details" endpoint used by the click-to-fetch button in the
 * Applications table.
 *
 * Mirrors exactly what the Delhi Police portal's own public "Track
 * Application" page calls, confirmed from its Network tab:
 *   1. POST /search-pcc-application   { applicationNumber, applicantName, guardianName }
 *   2. POST /get-pcc-applicant-details { applicationID }   <- capital ID
 *   3. POST /get-pcc-application-status { applicationId }  <- lowercase d
 *
 * All three are the same public lookup the portal exposes to anyone tracking
 * their own application — nothing admin-only.
 *
 * Body: { applicationNumber, applicantName, guardianName }
 */
app.post("/api/pcc-status/check", async (req, res) => {
  const { applicationNumber, applicantName, guardianName } = req.body || {};
  if (!applicationNumber || !applicantName) {
    return res.status(400).json({ success: false, error: "applicationNumber and applicantName are required" });
  }

  try {
    const searchResult = await delhiClient.post("/search-pcc-application", {
      applicationNumber,
      applicantName,
      guardianName,
    });

    const application = searchResult.data?.data?.[0] || null;
    if (!application?.applicationID) {
      return res.json({ success: false, stage: "search", raw: searchResult.data });
    }

    const id = String(application.applicationID);

    const [detailsResult, statusResult] = await Promise.allSettled([
      delhiClient.post("/get-pcc-applicant-details", { applicationID: id }),
      delhiClient.post("/get-pcc-application-status", { applicationId: id }),
    ]);

    return res.json({
      success: true,
      application,
      details: detailsResult.status === "fulfilled" ? detailsResult.value.data?.data || null : null,
      status: statusResult.status === "fulfilled" ? statusResult.value.data?.data || null : null,
      statusError: statusResult.status === "rejected"
        ? { message: statusResult.reason.message, body: statusResult.reason.response?.data || null }
        : null,
    });
  } catch (err) {
    console.error("PCC check failed:", err.message);
    res.status(err.response?.status || 500).json({
      success: false,
      error: err.message,
      details: err.response?.data,
    });
  }
});

app.listen(PORT, () => {
  console.log(`PCC status proxy server running on http://localhost:${PORT}`);
});
