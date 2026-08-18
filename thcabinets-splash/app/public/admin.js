(function () {
  const form = document.getElementById("upload-form");
  const filesInput = document.getElementById("files");
  const tagsInput = document.getElementById("tags");
  const uploadBtn = document.getElementById("upload-btn");
  const statusEl = document.getElementById("upload-status");
  const tbody = document.getElementById("photo-tbody");

  function setStatus(message, kind) {
    statusEl.textContent = message;
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function formatDate(iso) {
    if (!iso) return "";
    return new Date(iso.replace(" ", "T") + "Z").toLocaleDateString();
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
        const res = await fetch(`/api/photos/${photo.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags: tagsField.value }),
        });
        if (!res.ok) throw new Error();
      } catch {
        setStatus("Failed to save tags.", "error");
      }
    });
    tagsTd.appendChild(tagsField);
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
      await loadPhotos();
    } catch (err) {
      setStatus(err.message || "Upload failed.", "error");
    } finally {
      uploadBtn.disabled = false;
    }
  });

  loadPhotos();
})();
