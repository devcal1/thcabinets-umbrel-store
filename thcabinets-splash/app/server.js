const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const CONFIG_DIR = process.env.CONFIG_DIR || path.join(__dirname, "config");
fs.mkdirSync(CONFIG_DIR, { recursive: true });
const GEMINI_KEY_FILE = path.join(CONFIG_DIR, "gemini-api-key");
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

function getGeminiApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  try {
    return fs.readFileSync(GEMINI_KEY_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

const db = require("./db");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/photos", express.static(UPLOADS_DIR, { maxAge: "30d", immutable: true }));

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const THUMB_WIDTH = 700;

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error("Unsupported file type"));
      return;
    }
    cb(null, true);
  },
});

const suggestUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error("Unsupported file type"));
      return;
    }
    cb(null, true);
  },
});

const TAG_SUGGESTION_PROMPT = `You are helping tag photos of custom kitchen and joinery work for a
searchable photo library at a cabinet-making showroom. Look closely at this photo and identify 3-6
specific tags a customer might search for: the room type (e.g. kitchen, laundry, pantry, walk-in
robe, bathroom vanity, study), the design style (e.g. farmhouse, modern, shaker, hamptons,
industrial, scandinavian), and the visible materials, colours, or finishes (e.g. oak, matte black,
stone benchtop, white, walnut, two-tone, brass hardware). Base every tag only on what you can
actually see — don't guess at things outside the frame. Prefer specific, descriptive tags over
generic ones like "cabinet" or "wood" alone.`;

const TAG_SUGGESTION_SCHEMA = {
  type: "array",
  items: { type: "string" },
};

async function suggestTagsForImage(buffer, mimeType) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    const err = new Error("Tag suggestions aren't configured yet.");
    err.code = "NOT_CONFIGURED";
    throw err;
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: TAG_SUGGESTION_SCHEMA,
    },
  });
  const result = await model.generateContent([
    TAG_SUGGESTION_PROMPT,
    { inlineData: { data: buffer.toString("base64"), mimeType } },
  ]);
  const text = result.response.text();
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned unparseable output: ${text.slice(0, 200)}`);
  }
  if (!Array.isArray(raw)) {
    throw new Error("Gemini didn't return a list of tags");
  }
  return [...new Set(
    raw
      .filter((t) => typeof t === "string")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
  )].slice(0, 8);
}

function rowToPhoto(row) {
  return {
    id: row.id,
    url: `/photos/${row.filename}`,
    thumbUrl: `/photos/${row.thumb_filename}`,
    width: row.width,
    height: row.height,
    tags: row.tags,
    createdAt: row.created_at,
  };
}

app.get("/healthz", (req, res) => res.json({ ok: true }));

app.get("/api/photos", (req, res) => {
  const rows = db.prepare("SELECT * FROM photos ORDER BY created_at DESC, id DESC").all();
  res.json(rows.map(rowToPhoto));
});

app.post("/api/photos", (req, res) => {
  upload.array("photos", 100)(req, res, async (err) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    const files = req.files || [];
    if (files.length === 0) {
      res.status(400).json({ error: "No files uploaded" });
      return;
    }
    const tags = (req.body.tags || "").trim();

    const insert = db.prepare(
      "INSERT INTO photos (filename, thumb_filename, width, height, tags) VALUES (?, ?, ?, ?, ?)"
    );

    const created = [];
    try {
      for (const file of files) {
        const image = sharp(file.path);
        const metadata = await image.metadata();
        const thumbFilename = `${path.parse(file.filename).name}-thumb.webp`;
        await image
          .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(path.join(UPLOADS_DIR, thumbFilename));

        const info = insert.run(
          file.filename,
          thumbFilename,
          metadata.width,
          metadata.height,
          tags
        );
        created.push(rowToPhoto(db.prepare("SELECT * FROM photos WHERE id = ?").get(info.lastInsertRowid)));
      }
      res.status(201).json(created);
    } catch (e) {
      res.status(500).json({ error: "Failed to process uploaded image(s)" });
    }
  });
});

app.post("/api/suggest-tags", (req, res) => {
  suggestUpload.single("photo")(req, res, async (err) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No photo uploaded" });
      return;
    }
    try {
      const tags = await suggestTagsForImage(req.file.buffer, req.file.mimetype);
      res.json({ tags });
    } catch (e) {
      if (e.code === "NOT_CONFIGURED") {
        res.status(501).json({ error: e.message, code: e.code });
        return;
      }
      console.error("Tag suggestion failed:", e);
      res.status(502).json({ error: `Tag suggestion failed: ${e.message}` });
    }
  });
});

app.patch("/api/photos/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM photos WHERE id = ?").get(id);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const tags = typeof req.body.tags === "string" ? req.body.tags.trim() : row.tags;
  db.prepare("UPDATE photos SET tags = ? WHERE id = ?").run(tags, id);
  res.json(rowToPhoto(db.prepare("SELECT * FROM photos WHERE id = ?").get(id)));
});

app.delete("/api/photos/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM photos WHERE id = ?").get(id);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  for (const filename of [row.filename, row.thumb_filename]) {
    const filePath = path.join(UPLOADS_DIR, filename);
    fs.rm(filePath, { force: true }, () => {});
  }
  db.prepare("DELETE FROM photos WHERE id = ?").run(id);
  res.status(204).end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`TH Cabinets web listening on port ${PORT}`);
});
