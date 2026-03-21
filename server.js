require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fetch = require("node-fetch");
const FormData = require("form-data");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Target Felt map
const FELT_MAP_ID = "z9BIC4uGlQfOXcwHwYGKwRC";
const FELT_MAP_URL =
  "https://felt.com/map/API-TESTING-z9BIC4uGlQfOXcwHwYGKwRC?share=1&loc=44.6489,-63.5753,14z";

// Keep uploaded files in memory (no disk writes needed)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB limit
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".geojson" || ext === ".json" || file.mimetype === "application/geo+json") {
      cb(null, true);
    } else {
      cb(new Error("Only GeoJSON files (.geojson / .json) are accepted"));
    }
  },
});

app.use(express.static("public"));

// Health / config endpoint so the frontend can confirm the server is ready
app.get("/api/config", (_req, res) => {
  const ready = Boolean(process.env.FELT_API_KEY);
  res.json({ ready, mapUrl: FELT_MAP_URL });
});

// Upload endpoint
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    const apiKey = process.env.FELT_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "FELT_API_KEY is not configured on the server." });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file provided." });
    }

    const layerName = (req.body.layerName || req.file.originalname).trim();

    // ── Step 1: Request a presigned S3 upload URL from Felt ──────────────────
    const feltRes = await fetch(`https://felt.com/api/v2/maps/${FELT_MAP_ID}/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: layerName }),
    });

    if (!feltRes.ok) {
      const body = await feltRes.text();
      return res.status(feltRes.status).json({
        error: `Felt API error (${feltRes.status}): ${body}`,
      });
    }

    const presigned = await feltRes.json();
    const { url, presigned_attributes, layer_id } = presigned;

    if (!url || !presigned_attributes) {
      return res.status(500).json({
        error: "Unexpected response from Felt API — missing presigned upload details.",
        detail: presigned,
      });
    }

    // ── Step 2: Upload the file directly to Amazon S3 ────────────────────────
    const form = new FormData();
    for (const [key, value] of Object.entries(presigned_attributes)) {
      form.append(key, value);
    }
    // The file field MUST be last per AWS presigned POST requirements
    form.append("file", req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype || "application/geo+json",
    });

    const s3Res = await fetch(url, { method: "POST", body: form });

    if (s3Res.status !== 204) {
      const s3Body = await s3Res.text();
      return res.status(500).json({
        error: `S3 upload failed (${s3Res.status}): ${s3Body}`,
      });
    }

    // Success
    res.json({
      success: true,
      layerName,
      layerId: layer_id,
      mapUrl: FELT_MAP_URL,
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Multer error handler (file type / size rejections)
app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`Felt GeoJSON Uploader running at http://localhost:${PORT}`);
  console.log(`Target map: ${FELT_MAP_URL}`);
  if (!process.env.FELT_API_KEY) {
    console.warn("WARNING: FELT_API_KEY is not set. Uploads will fail until it is configured.");
  }
});
