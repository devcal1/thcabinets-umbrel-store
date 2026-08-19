(function () {
  const form = document.getElementById("upload-form");
  const filesInput = document.getElementById("files");
  const tagsInput = document.getElementById("tags");
  const uploadBtn = document.getElementById("upload-btn");
  const statusEl = document.getElementById("upload-status");
  const tbody = document.getElementById("photo-tbody");
  const filePreview = document.getElementById("file-preview");

  let previewUrls = [];

  function clearFilePreview() {
    for (const url of previewUrls) URL.revokeObjectURL(url);
    previewUrls = [];
    filePreview.innerHTML = "";
  }

  filesInput.addEventListener("change", () => {
    clearFilePreview();
    for (const file of filesInput.files) {
      const url = URL.createObjectURL(file);
      previewUrls.push(url);
      const img = document.createElement("img");
      img.src = url;
      img.alt = file.name;
      filePreview.appendChild(img);
    }
  });

  function setStatus(message, kind) {
    statusEl.textContent = message;
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function formatDate(iso) {
    if (!iso) return "";
    return new Date(iso.replace(" ", "T") + "Z").toLocaleDateString();
  }

  function splitTags(value) {
    return value.split(",").map((t) => t.trim()).filter(Boolean);
  }

  async function saveTags(photoId, value) {
    const res = await fetch(`/api/photos/${photoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: value }),
    });
    if (!res.ok) throw new Error();
  }

  function renderRow(photo) {
    const tr = document.createElement("tr");

    const photoTd = document.createElement("td");
    const img = document.createElement("img");
    img.src = photo.thumbUrl;
    img.alt = photo.tags || "Job photo";
    photoTd.appendChild(img);
    tr.appendChild(photoTd);

    const tagsTd = document.createElement("td");
    const tagsField = document.createElement("input");
    tagsField.className = "input tags-input";
    tagsField.value = photo.tags || "";
    tagsField.addEventListener("change", async () => {
      try {
        await saveTags(photo.id, tagsField.value);
      } catch {
        setStatus("Failed to save tags.", "error");
      }
    });
    tagsTd.appendChild(tagsField);

    const addTagRow = document.createElement("div");
    addTagRow.className = "add-tag-row";
    const addTagInput = document.createElement("input");
    addTagInput.className = "input";
    addTagInput.placeholder = "add a tag…";
    const addTagBtn = document.createElement("button");
    addTagBtn.type = "button";
    addTagBtn.className = "btn btn-secondary";
    addTagBtn.textContent = "+";
    const appendTag = async () => {
      const newTags = splitTags(addTagInput.value);
      if (newTags.length === 0) return;
      const existing = splitTags(tagsField.value);
      const existingLower = new Set(existing.map((t) => t.toLowerCase()));
      for (const t of newTags) {
        if (!existingLower.has(t.toLowerCase())) {
          existing.push(t);
          existingLower.add(t.toLowerCase());
        }
      }
      const combined = existing.join(", ");
      addTagBtn.disabled = true;
      try {
        await saveTags(photo.id, combined);
        tagsField.value = combined;
        addTagInput.value = "";
      } catch {
        setStatus("Failed to add tag.", "error");
      } finally {
        addTagBtn.disabled = false;
      }
    };
    addTagBtn.addEventListener("click", appendTag);
    addTagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        appendTag();
      }
    });
    addTagRow.appendChild(addTagInput);
    addTagRow.appendChild(addTagBtn);
    tagsTd.appendChild(addTagRow);

    tr.appendChild(tagsTd);

    const dateTd = document.createElement("td");
    dateTd.className = "text-muted";
    dateTd.textContent = formatDate(photo.createdAt);
    tr.appendChild(dateTd);

    const actionsTd = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn-ghost";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async () => {
      if (!confirm("Delete this photo? This can't be undone.")) return;
      try {
        const res = await fetch(`/api/photos/${photo.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error();
        tr.remove();
      } catch {
        setStatus("Failed to delete photo.", "error");
      }
    });
    actions.appendChild(deleteBtn);
    actionsTd.appendChild(actions);
    tr.appendChild(actionsTd);

    return tr;
  }

  async function loadPhotos() {
    tbody.innerHTML = '<tr><td colspan="4" class="text-muted">Loading…</td></tr>';
    try {
      const res = await fetch("/api/photos");
      const photos = await res.json();
      tbody.innerHTML = "";
      if (photos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-muted">No photos yet.</td></tr>';
        return;
      }
      for (const photo of photos) {
        tbody.appendChild(renderRow(photo));
      }
    } catch {
      tbody.innerHTML = '<tr><td colspan="4" class="status error">Failed to load photos.</td></tr>';
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!filesInput.files.length) return;

    const formData = new FormData();
    for (const file of filesInput.files) {
      formData.append("photos", file);
    }
    formData.append("tags", tagsInput.value);

    uploadBtn.disabled = true;
    setStatus(`Uploading ${filesInput.files.length} photo(s)…`);
    try {
      const res = await fetch("/api/photos", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Upload failed");
      }
      setStatus("Upload complete.", "ok");
      form.reset();
      clearFilePreview();
      await loadPhotos();
    } catch (err) {
      setStatus(err.message || "Upload failed.", "error");
    } finally {
      uploadBtn.disabled = false;
    }
  });

  // — Bulk folder import —
  const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
  const MAX_BULK_FILE_BYTES = 25 * 1024 * 1024;
  const IGNORE_FILENAMES = new Set(["thumbs.db", "desktop.ini", ".ds_store"]);

  const bulkFolderInput = document.getElementById("bulk-folder");
  const bulkReview = document.getElementById("bulk-review");
  const bulkReviewTbody = document.getElementById("bulk-review-tbody");
  const bulkSkippedEl = document.getElementById("bulk-skipped");
  const bulkImportBtn = document.getElementById("bulk-import-btn");
  const bulkCancelBtn = document.getElementById("bulk-cancel-btn");
  const bulkStatusEl = document.getElementById("bulk-status");

  let bulkGroups = []; // [{ folder, tagInput: HTMLInputElement, checkbox: HTMLInputElement, files: File[] }]

  function setBulkStatus(message, kind) {
    bulkStatusEl.textContent = message;
    bulkStatusEl.className = "status" + (kind ? " " + kind : "");
  }

  function extOf(filename) {
    const i = filename.lastIndexOf(".");
    return i === -1 ? "" : filename.slice(i).toLowerCase();
  }

  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function groupFilesByFolder(fileList) {
    const groups = new Map(); // folder name -> File[]
    const skipped = []; // { path, reason }

    for (const file of fileList) {
      const relPath = file.webkitRelativePath || file.name;
      const parts = relPath.split("/");
      const baseName = parts[parts.length - 1];

      if (IGNORE_FILENAMES.has(baseName.toLowerCase())) continue;

      if (parts.length < 2) {
        skipped.push({ path: relPath, reason: "not inside a subfolder" });
        continue;
      }
      const folder = parts[parts.length - 2];

      if (!ALLOWED_EXT.has(extOf(baseName))) {
        skipped.push({ path: relPath, reason: "unsupported file type" });
        continue;
      }
      if (file.size > MAX_BULK_FILE_BYTES) {
        skipped.push({ path: relPath, reason: `over ${formatBytes(MAX_BULK_FILE_BYTES)} limit` });
        continue;
      }

      if (!groups.has(folder)) groups.set(folder, []);
      groups.get(folder).push(file);
    }

    return { groups, skipped };
  }

  function renderBulkReview(groups, skipped) {
    bulkReviewTbody.innerHTML = "";
    bulkGroups = [];

    for (const [folder, files] of groups) {
      const tr = document.createElement("tr");

      const checkTd = document.createElement("td");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      checkTd.appendChild(checkbox);
      tr.appendChild(checkTd);

      const folderTd = document.createElement("td");
      folderTd.textContent = folder;
      tr.appendChild(folderTd);

      const tagTd = document.createElement("td");
      const tagInput = document.createElement("input");
      tagInput.className = "input tags-input";
      tagInput.value = folder.toLowerCase();
      tagTd.appendChild(tagInput);
      tr.appendChild(tagTd);

      const countTd = document.createElement("td");
      const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
      countTd.textContent = `${files.length} (${formatBytes(totalBytes)})`;
      tr.appendChild(countTd);

      bulkReviewTbody.appendChild(tr);
      bulkGroups.push({ folder, tagInput, checkbox, files });
    }

    if (skipped.length === 0) {
      bulkSkippedEl.textContent = "";
    } else {
      const reasons = skipped.slice(0, 5).map((s) => `${s.path} (${s.reason})`).join(", ");
      const more = skipped.length > 5 ? ` and ${skipped.length - 5} more` : "";
      bulkSkippedEl.textContent = `Skipping ${skipped.length} file(s): ${reasons}${more}.`;
    }

    setBulkStatus("");
    bulkReview.style.display = bulkGroups.length ? "" : "none";
    if (!bulkGroups.length) {
      setBulkStatus("No images found in that folder.", "error");
      bulkReview.style.display = "";
    }
  }

  bulkFolderInput.addEventListener("change", () => {
    const { groups, skipped } = groupFilesByFolder(bulkFolderInput.files);
    renderBulkReview(groups, skipped);
  });

  bulkCancelBtn.addEventListener("click", () => {
    bulkFolderInput.value = "";
    bulkGroups = [];
    bulkReview.style.display = "none";
    setBulkStatus("");
  });

  bulkImportBtn.addEventListener("click", async () => {
    const selected = bulkGroups.filter((g) => g.checkbox.checked);
    if (selected.length === 0) {
      setBulkStatus("Nothing selected to import.", "error");
      return;
    }

    bulkImportBtn.disabled = true;
    bulkCancelBtn.disabled = true;
    let done = 0;
    let failedFolders = [];

    for (const group of selected) {
      done += 1;
      setBulkStatus(`Importing ${done}/${selected.length}: ${group.folder} (${group.files.length} photos)…`);
      const formData = new FormData();
      for (const file of group.files) formData.append("photos", file);
      formData.append("tags", group.tagInput.value);

      try {
        const res = await fetch("/api/photos", { method: "POST", body: formData });
        if (!res.ok) throw new Error();
      } catch {
        failedFolders.push(group.folder);
      }
    }

    bulkImportBtn.disabled = false;
    bulkCancelBtn.disabled = false;

    if (failedFolders.length === 0) {
      setBulkStatus(`Imported ${selected.length} folder(s) successfully.`, "ok");
      bulkFolderInput.value = "";
      bulkGroups = [];
      bulkReview.style.display = "none";
    } else {
      setBulkStatus(`Done, but these folders failed: ${failedFolders.join(", ")}. Try importing them again.`, "error");
    }

    await loadPhotos();
  });

  loadPhotos();
})();
