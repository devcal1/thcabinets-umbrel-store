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
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

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
    const failed = [];
    for (const file of files) {
      try {
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
      } catch (e) {
        console.error(`Failed to process ${file.originalname}:`, e);
        failed.push({ filename: file.originalname, error: e.message });
        fs.rm(file.path, { force: true }, () => {});
      }
    }
    res.status(created.length > 0 ? 201 : 500).json({ created, failed });
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

// ---------------------------------------------------------------------------
// Schedule (manufacturing / installing job board)
// ---------------------------------------------------------------------------

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri"];
const DAY_LABELS = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateUTC(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function formatDateUTC(date) {
  return date.toISOString().slice(0, 10);
}
function addDays(s, n) {
  const d = parseDateUTC(s);
  d.setUTCDate(d.getUTCDate() + n);
  return formatDateUTC(d);
}
function mondayOf(s) {
  const d = parseDateUTC(s);
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return formatDateUTC(d);
}
function weekLabel(startStr) {
  const start = parseDateUTC(startStr);
  const end = parseDateUTC(addDays(startStr, 4));
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const startPart = `${start.getUTCDate()}${sameMonth ? "" : ` ${MONTHS[start.getUTCMonth()]}`}`;
  const endPart = `${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
  return `${startPart}–${endPart}`;
}
function hueColors(hue) {
  return {
    bg: `oklch(30% 0.06 ${hue})`,
    fg: `oklch(86% 0.10 ${hue})`,
  };
}
function rowToWorker(row) {
  const { bg, fg } = hueColors(row.hue);
  return {
    id: row.id,
    name: row.name,
    hue: row.hue,
    bg,
    fg,
    archived: !!row.archived,
    sortOrder: row.sort_order,
  };
}
function rowToJob(row) {
  return { id: row.id, name: row.name, notes: row.notes, archived: !!row.archived };
}

function buildScheduleRow(weekRow) {
  const cells = {};
  for (const key of DAY_KEYS) cells[key] = [];
  const assignments = db
    .prepare(
      `SELECT a.id AS assignment_id, a.day, w.id AS worker_id, w.name, w.hue
       FROM assignments a JOIN workers w ON w.id = a.worker_id
       WHERE a.week_row_id = ? ORDER BY a.id ASC`
    )
    .all(weekRow.id);
  for (const a of assignments) {
    const { bg, fg } = hueColors(a.hue);
    cells[a.day].push({ assignmentId: a.assignment_id, workerId: a.worker_id, name: a.name, bg, fg });
  }
  return {
    rowId: weekRow.id,
    jobId: weekRow.job_id,
    jobName: weekRow.job_name,
    notes: weekRow.notes,
    cells,
  };
}

function buildWeekPanel(weekStart, panel) {
  const weekRows = db
    .prepare(
      `SELECT wr.id, wr.job_id, wr.sort_order, j.name AS job_name, j.notes
       FROM week_rows wr JOIN jobs j ON j.id = wr.job_id
       WHERE wr.week_start = ? AND wr.panel = ?
       ORDER BY wr.sort_order ASC, wr.id ASC`
    )
    .all(weekStart, panel);
  return weekRows.map(buildScheduleRow);
}

function buildWeek(weekStart) {
  return {
    start: weekStart,
    label: weekLabel(weekStart),
    manufacturing: buildWeekPanel(weekStart, "manufacturing"),
    installing: buildWeekPanel(weekStart, "installing"),
  };
}

function getWeekRowOr404(id, res) {
  const row = db.prepare("SELECT * FROM week_rows WHERE id = ?").get(id);
  if (!row) {
    res.status(404).json({ error: "Row not found" });
    return null;
  }
  return row;
}

// --- Workers ---

app.get("/api/workers", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM workers ORDER BY archived ASC, sort_order ASC, id ASC")
    .all();
  res.json(rows.map(rowToWorker));
});

app.post("/api/workers", (req, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "Name is required" });
    return;
  }
  const total = db.prepare("SELECT COUNT(*) AS n FROM workers").get().n;
  const maxOrder = db.prepare("SELECT MAX(sort_order) AS m FROM workers").get().m;
  const hue = (total * 137) % 360;
  const info = db
    .prepare("INSERT INTO workers (name, hue, sort_order) VALUES (?, ?, ?)")
    .run(name, hue, (maxOrder ?? -1) + 1);
  res.status(201).json(rowToWorker(db.prepare("SELECT * FROM workers WHERE id = ?").get(info.lastInsertRowid)));
});

app.patch("/api/workers/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM workers WHERE id = ?").get(id);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const name = typeof req.body.name === "string" ? req.body.name.trim() || row.name : row.name;
  const hue = Number.isInteger(req.body.hue) ? ((req.body.hue % 360) + 360) % 360 : row.hue;
  const archived = typeof req.body.archived === "boolean" ? (req.body.archived ? 1 : 0) : row.archived;
  db.prepare("UPDATE workers SET name = ?, hue = ?, archived = ? WHERE id = ?").run(name, hue, archived, id);
  res.json(rowToWorker(db.prepare("SELECT * FROM workers WHERE id = ?").get(id)));
});

// --- Jobs ---

app.get("/api/jobs", (req, res) => {
  const rows = db.prepare("SELECT * FROM jobs WHERE archived = 0 ORDER BY name ASC").all();
  res.json(rows.map(rowToJob));
});

app.patch("/api/jobs/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const name = typeof req.body.name === "string" ? req.body.name.trim() || row.name : row.name;
  const notes = typeof req.body.notes === "string" ? req.body.notes : row.notes;
  db.prepare("UPDATE jobs SET name = ?, notes = ? WHERE id = ?").run(name, notes, id);
  res.json(rowToJob(db.prepare("SELECT * FROM jobs WHERE id = ?").get(id)));
});

// --- Schedule ---

app.get("/api/schedule", (req, res) => {
  const requested = typeof req.query.week === "string" && DATE_RE.test(req.query.week) ? req.query.week : formatDateUTC(new Date());
  const week1Start = mondayOf(requested);
  const week2Start = addDays(week1Start, 7);
  res.json({ weeks: [buildWeek(week1Start), buildWeek(week2Start)] });
});

app.post("/api/rows", (req, res) => {
  const { weekStart, panel, jobId, jobName, notes } = req.body;
  if (typeof weekStart !== "string" || !DATE_RE.test(weekStart)) {
    res.status(400).json({ error: "weekStart must be a YYYY-MM-DD date" });
    return;
  }
  if (panel !== "manufacturing" && panel !== "installing") {
    res.status(400).json({ error: "panel must be 'manufacturing' or 'installing'" });
    return;
  }
  const snappedWeekStart = mondayOf(weekStart);

  let resolvedJobId = null;
  if (Number.isInteger(jobId)) {
    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    resolvedJobId = job.id;
  } else {
    const name = typeof jobName === "string" ? jobName.trim() : "";
    if (!name) {
      res.status(400).json({ error: "jobId or jobName is required" });
      return;
    }
    const info = db
      .prepare("INSERT INTO jobs (name, notes) VALUES (?, ?)")
      .run(name, typeof notes === "string" ? notes : "");
    resolvedJobId = info.lastInsertRowid;
  }

  const maxOrder = db
    .prepare("SELECT MAX(sort_order) AS m FROM week_rows WHERE week_start = ? AND panel = ?")
    .get(snappedWeekStart, panel).m;
  const info = db
    .prepare("INSERT INTO week_rows (job_id, week_start, panel, sort_order) VALUES (?, ?, ?, ?)")
    .run(resolvedJobId, snappedWeekStart, panel, (maxOrder ?? -1) + 1);

  const weekRow = db
    .prepare(
      `SELECT wr.id, wr.job_id, wr.sort_order, j.name AS job_name, j.notes
       FROM week_rows wr JOIN jobs j ON j.id = wr.job_id WHERE wr.id = ?`
    )
    .get(info.lastInsertRowid);
  res.status(201).json(buildScheduleRow(weekRow));
});

app.patch("/api/rows/:id/move", (req, res) => {
  const id = Number(req.params.id);
  const row = getWeekRowOr404(id, res);
  if (!row) return;
  const direction = req.body.direction;
  if (direction !== "up" && direction !== "down") {
    res.status(400).json({ error: "direction must be 'up' or 'down'" });
    return;
  }
  const siblings = db
    .prepare(
      "SELECT id, sort_order FROM week_rows WHERE week_start = ? AND panel = ? ORDER BY sort_order ASC, id ASC"
    )
    .all(row.week_start, row.panel);
  const idx = siblings.findIndex((s) => s.id === id);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= siblings.length) {
    res.status(204).end();
    return;
  }
  const a = siblings[idx];
  const b = siblings[swapIdx];
  const swap = db.transaction(() => {
    db.prepare("UPDATE week_rows SET sort_order = ? WHERE id = ?").run(b.sort_order, a.id);
    db.prepare("UPDATE week_rows SET sort_order = ? WHERE id = ?").run(a.sort_order, b.id);
  });
  swap();
  res.status(204).end();
});

app.delete("/api/rows/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = getWeekRowOr404(id, res);
  if (!row) return;
  const del = db.transaction(() => {
    db.prepare("DELETE FROM assignments WHERE week_row_id = ?").run(id);
    db.prepare("DELETE FROM week_rows WHERE id = ?").run(id);
  });
  del();
  res.status(204).end();
});

app.post("/api/rows/:id/duplicate", (req, res) => {
  const id = Number(req.params.id);
  const row = getWeekRowOr404(id, res);
  if (!row) return;
  const toWeekStart =
    typeof req.body.toWeekStart === "string" && DATE_RE.test(req.body.toWeekStart)
      ? mondayOf(req.body.toWeekStart)
      : addDays(row.week_start, 7);

  const maxOrder = db
    .prepare("SELECT MAX(sort_order) AS m FROM week_rows WHERE week_start = ? AND panel = ?")
    .get(toWeekStart, row.panel).m;

  const newRowId = db.transaction(() => {
    const info = db
      .prepare("INSERT INTO week_rows (job_id, week_start, panel, sort_order) VALUES (?, ?, ?, ?)")
      .run(row.job_id, toWeekStart, row.panel, (maxOrder ?? -1) + 1);
    const assignments = db
      .prepare("SELECT day, worker_id FROM assignments WHERE week_row_id = ?")
      .all(id);
    const insertAssignment = db.prepare(
      "INSERT INTO assignments (week_row_id, day, worker_id) VALUES (?, ?, ?)"
    );
    for (const a of assignments) insertAssignment.run(info.lastInsertRowid, a.day, a.worker_id);
    return info.lastInsertRowid;
  })();

  const weekRow = db
    .prepare(
      `SELECT wr.id, wr.job_id, wr.sort_order, j.name AS job_name, j.notes
       FROM week_rows wr JOIN jobs j ON j.id = wr.job_id WHERE wr.id = ?`
    )
    .get(newRowId);
  res.status(201).json(buildScheduleRow(weekRow));
});

app.post("/api/rows/:id/assignments", (req, res) => {
  const id = Number(req.params.id);
  const row = getWeekRowOr404(id, res);
  if (!row) return;
  const { day, workerId } = req.body;
  if (!DAY_KEYS.includes(day)) {
    res.status(400).json({ error: "day must be one of " + DAY_KEYS.join(", ") });
    return;
  }
  const worker = db.prepare("SELECT * FROM workers WHERE id = ?").get(workerId);
  if (!worker) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }
  const info = db
    .prepare("INSERT INTO assignments (week_row_id, day, worker_id) VALUES (?, ?, ?)")
    .run(id, day, worker.id);
  const { bg, fg } = hueColors(worker.hue);
  res.status(201).json({ assignmentId: info.lastInsertRowid, workerId: worker.id, name: worker.name, bg, fg, day });
});

app.delete("/api/assignments/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM assignments WHERE id = ?").get(id);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  db.prepare("DELETE FROM assignments WHERE id = ?").run(id);
  res.status(204).end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`TH Cabinets web listening on port ${PORT}`);
});
