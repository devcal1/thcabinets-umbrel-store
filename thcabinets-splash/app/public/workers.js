(function () {
  const listEl = document.getElementById("workerList");
  const newNameInput = document.getElementById("newWorkerName");
  const addBtn = document.getElementById("addWorkerBtn");

  async function api(path, options) {
    const res = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options && options.headers) },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function toast(msg) {
    const el = document.createElement("div");
    el.textContent = msg;
    el.style.cssText =
      "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--color-surface);" +
      "color:var(--color-text);border:1px solid var(--color-divider);border-radius:8px;padding:8px 14px;" +
      "font-size:13px;z-index:50;box-shadow:var(--shadow-md)";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }

  function guarded(fn) {
    return async (...args) => {
      try {
        await fn(...args);
      } catch (e) {
        toast(`Error: ${e.message}`);
      }
    };
  }

  function hueColors(hue) {
    return { bg: `oklch(30% 0.06 ${hue})`, fg: `oklch(86% 0.10 ${hue})` };
  }

  async function loadWorkers() {
    const workers = await api("/api/workers");
    render(workers);
  }

  function render(workers) {
    listEl.innerHTML = "";
    for (const w of workers) {
      const row = document.createElement("div");
      row.className = "worker-row" + (w.archived ? " archived" : "");

      const swatch = document.createElement("div");
      swatch.className = "swatch";
      swatch.style.background = w.bg;
      row.appendChild(swatch);

      const nameInput = document.createElement("input");
      nameInput.className = "input";
      nameInput.type = "text";
      nameInput.value = w.name;
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") nameInput.blur();
      });
      nameInput.addEventListener("blur", guarded(async () => {
        const value = nameInput.value.trim();
        if (!value || value === w.name) {
          nameInput.value = w.name;
          return;
        }
        await api(`/api/workers/${w.id}`, { method: "PATCH", body: JSON.stringify({ name: value }) });
        await loadWorkers();
      }));
      row.appendChild(nameInput);

      const hueWrap = document.createElement("div");
      hueWrap.className = "hue-row";
      const hueInput = document.createElement("input");
      hueInput.type = "range";
      hueInput.min = 0;
      hueInput.max = 359;
      hueInput.value = w.hue;
      hueInput.addEventListener("input", () => {
        swatch.style.background = hueColors(Number(hueInput.value)).bg;
      });
      hueInput.addEventListener("change", guarded(async () => {
        await api(`/api/workers/${w.id}`, { method: "PATCH", body: JSON.stringify({ hue: Number(hueInput.value) }) });
        await loadWorkers();
      }));
      hueWrap.appendChild(hueInput);
      row.appendChild(hueWrap);

      const archiveBtn = document.createElement("button");
      archiveBtn.type = "button";
      archiveBtn.className = "btn btn-secondary";
      archiveBtn.textContent = w.archived ? "Restore" : "Archive";
      archiveBtn.addEventListener("click", guarded(async () => {
        await api(`/api/workers/${w.id}`, { method: "PATCH", body: JSON.stringify({ archived: !w.archived }) });
        await loadWorkers();
      }));
      row.appendChild(archiveBtn);

      listEl.appendChild(row);
    }
  }

  const addWorker = guarded(async () => {
    const name = newNameInput.value.trim();
    if (!name) return;
    await api("/api/workers", { method: "POST", body: JSON.stringify({ name }) });
    newNameInput.value = "";
    await loadWorkers();
  });
  addBtn.addEventListener("click", addWorker);
  newNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addWorker();
  });

  loadWorkers().catch((e) => {
    listEl.textContent = `Couldn't load workers: ${e.message}`;
  });
})();
