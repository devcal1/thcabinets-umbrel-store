const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const sharp = require("sharp");

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = require("./db");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/photos", express.static(UPLOADS_DIR, { maxAge: "30d", immutable: true }));

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_BYTES = 15 * 1024 * 1024;
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
  upload.array("photos", 50)(req, res, async (err) => {
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
