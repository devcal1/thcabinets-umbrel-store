(function () {
  const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri"];
  const DAY_LABELS = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri" };
  const PANELS = [
    { key: "manufacturing", label: "Manufacturing" },
    { key: "installing", label: "Installing" },
  ];

  const weeksContainer = document.getElementById("weeksContainer");
  const legendEl = document.getElementById("legend");
  const weekPicker = document.getElementById("weekPicker");
  const popover = document.getElementById("popover");

  const state = {
    workers: [],
    jobs: [],
    weeks: [],
    weekStart: mondayOf(localTodayStr()),
  };

  // --- date helpers (client-local, so "today" always matches the browser) ---
  function localTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function parseDate(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function formatDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function addDays(s, n) {
    const d = parseDate(s);
    d.setDate(d.getDate() + n);
    return formatDate(d);
  }
  function mondayOf(s) {
    const d = parseDate(s);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return formatDate(d);
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

  // --- data loading ---
  async function loadWorkers() {
    state.workers = await api("/api/workers");
  }
  async function loadJobs() {
    state.jobs = await api("/api/jobs");
  }
  async function loadSchedule() {
    const data = await api(`/api/schedule?week=${state.weekStart}`);
    state.weeks = data.weeks;
  }

  // --- legend ---
  function renderLegend() {
    legendEl.innerHTML = "";
    for (const w of state.workers.filter((w) => !w.archived)) {
      const span = document.createElement("span");
      span.className = "chip-worker";
      span.style.background = w.bg;
      span.style.color = w.fg;
      span.textContent = w.name;
      legendEl.appendChild(span);
    }
  }

  // --- chip element ---
  function chipEl(chip) {
    const span = document.createElement("span");
    span.className = "chip-worker";
    span.style.background = chip.bg;
    span.style.color = chip.fg;
    const nameSpan = document.createElement("span");
    nameSpan.textContent = chip.name;
    span.appendChild(nameSpan);
    const x = document.createElement("span");
    x.className = "chip-x";
    x.textContent = "×";
    x.title = "Remove";
    x.addEventListener("click", guarded(async (e) => {
      e.stopPropagation();
      await api(`/api/assignments/${chip.assignmentId}`, { method: "DELETE" });
      await refresh();
    }));
    span.appendChild(x);
    return span;
  }

  // --- worker picker popover ---
  let popoverTarget = null;
  function openPopover(anchorEl, rowId, day) {
    popoverTarget = { rowId, day };
    popover.innerHTML = "";
    const active = state.workers.filter((w) => !w.archived);
    if (active.length === 0) {
      const empty = document.createElement("div");
      empty.className = "popover-empty";
      empty.textContent = "No workers yet — add one on the Workers page.";
      popover.appendChild(empty);
    }
    for (const w of active) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "popover-item";
      const swatch = document.createElement("span");
      swatch.className = "popover-swatch";
      swatch.style.background = w.bg;
      btn.appendChild(swatch);
      const label = document.createElement("span");
      label.textContent = w.name;
      btn.appendChild(label);
      btn.addEventListener("click", guarded(async () => {
        closePopover();
        await api(`/api/rows/${rowId}/assignments`, {
          method: "POST",
          body: JSON.stringify({ day, workerId: w.id }),
        });
        await refresh();
      }));
      popover.appendChild(btn);
    }
    const rect = anchorEl.getBoundingClientRect();
    popover.style.left = `${Math.min(rect.left, window.innerWidth - 180)}px`;
    popover.style.top = `${rect.bottom + 4}px`;
    popover.hidden = false;
  }
  function closePopover() {
    popover.hidden = true;
    popoverTarget = null;
  }
  document.addEventListener("click", (e) => {
    if (!popover.hidden && !popover.contains(e.target) && !e.target.closest(".cell-add")) {
      closePopover();
    }
  });

  // --- row rendering ---
  function rowEl(row, panelKey, todayIndex) {
    const wrap = document.createDocumentFragment();

    const rowDiv = document.createElement("div");
    rowDiv.className = "sched-row";
    rowDiv.dataset.rowId = row.rowId;

    const jobCell = document.createElement("div");
    jobCell.className = "job-cell";

    const nameInput = document.createElement("input");
    nameInput.className = "job-name";
    nameInput.value = row.jobName;
    nameInput.spellcheck = false;
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") nameInput.blur();
    });
    nameInput.addEventListener("blur", guarded(async () => {
      const value = nameInput.value.trim();
      if (!value || value === row.jobName) {
        nameInput.value = row.jobName;
        return;
      }
      await api(`/api/jobs/${row.jobId}`, { method: "PATCH", body: JSON.stringify({ name: value }) });
      await refresh();
    }));
    jobCell.appendChild(nameInput);

    const actions = document.createElement("div");
    actions.className = "job-actions";
    actions.appendChild(iconBtn("ph-note-pencil", "Notes", () => toggleNotes(row.rowId)));
    actions.appendChild(iconBtn("ph-arrow-fat-lines-right", "Copy to next week", guarded(async () => {
      await api(`/api/rows/${row.rowId}/duplicate`, { method: "POST", body: JSON.stringify({}) });
      toast("Copied to next week");
      await refresh();
    })));
    actions.appendChild(iconBtn("ph-arrow-up", "Move up", guarded(async () => {
      await api(`/api/rows/${row.rowId}/move`, { method: "PATCH", body: JSON.stringify({ direction: "up" }) });
      await refresh();
    })));
    actions.appendChild(iconBtn("ph-arrow-down", "Move down", guarded(async () => {
      await api(`/api/rows/${row.rowId}/move`, { method: "PATCH", body: JSON.stringify({ direction: "down" }) });
      await refresh();
    })));
    actions.appendChild(iconBtn("ph-trash", "Remove row", guarded(async () => {
      if (!confirm(`Remove "${row.jobName}" from this week's ${panelKey} schedule?`)) return;
      await api(`/api/rows/${row.rowId}`, { method: "DELETE" });
      await refresh();
    })));
    jobCell.appendChild(actions);
    rowDiv.appendChild(jobCell);

    DAY_KEYS.forEach((day, i) => {
      const cell = document.createElement("div");
      cell.className = "sched-cell" + (i === todayIndex ? " today-col" : "");
      const chips = document.createElement("div");
      chips.className = "sched-chips";
      for (const chip of row.cells[day]) chips.appendChild(chipEl(chip));
      cell.appendChild(chips);
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "cell-add";
      addBtn.textContent = "+";
      addBtn.title = "Add worker";
      addBtn.addEventListener("click", () => openPopover(addBtn, row.rowId, day));
      cell.appendChild(addBtn);
      rowDiv.appendChild(cell);
    });

    wrap.appendChild(rowDiv);

    const notes = document.createElement("div");
    notes.className = "job-notes";
    notes.id = `notes-${row.rowId}`;
    notes.hidden = true;
    const textarea = document.createElement("textarea");
    textarea.className = "input";
    textarea.placeholder = "Notes for this job…";
    textarea.value = row.notes || "";
    notes.appendChild(textarea);
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn-secondary";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", guarded(async () => {
      await api(`/api/jobs/${row.jobId}`, { method: "PATCH", body: JSON.stringify({ notes: textarea.value }) });
      toast("Notes saved");
    }));
    notes.appendChild(saveBtn);
    wrap.appendChild(notes);

    return wrap;
  }

  function iconBtn(icon, title, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost btn-icon";
    btn.title = title;
    btn.innerHTML = `<i class="ph ${icon}"></i>`;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function toggleNotes(rowId) {
    const el = document.getElementById(`notes-${rowId}`);
    if (el) el.hidden = !el.hidden;
  }

  // --- panel rendering ---
  function panelEl(week, panelDef) {
    const panel = document.createElement("div");
    panel.className = "panel";

    const h3 = document.createElement("h3");
    h3.textContent = panelDef.label;
    panel.appendChild(h3);

    const grid = document.createElement("div");
    grid.className = "sched-grid";

    const today = localTodayStr();
    const dayOffset = Math.round((parseDate(today) - parseDate(week.start)) / 86400000);
    const todayIndex = dayOffset >= 0 && dayOffset < 5 ? dayOffset : -1;

    const head = document.createElement("div");
    head.className = "sched-row sched-head";
    const jobHead = document.createElement("div");
    jobHead.textContent = "Job";
    head.appendChild(jobHead);
    DAY_KEYS.forEach((day, i) => {
      const d = document.createElement("div");
      d.className = i === todayIndex ? "today-col" : "";
      d.textContent = DAY_LABELS[day];
      head.appendChild(d);
    });
    grid.appendChild(head);

    const rows = week[panelDef.key];
    for (const row of rows) grid.appendChild(rowEl(row, panelDef.key, todayIndex));

    panel.appendChild(grid);

    const addRow = document.createElement("div");
    addRow.className = "add-row";
    const input = document.createElement("input");
    input.className = "input";
    input.placeholder = "Add job…";
    input.setAttribute("list", "jobNamesList");
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn btn-primary";
    addBtn.textContent = "+ Add";
    const submitAdd = guarded(async () => {
      const name = input.value.trim();
      if (!name) return;
      const existing = state.jobs.find((j) => j.name.toLowerCase() === name.toLowerCase());
      const body = { weekStart: week.start, panel: panelDef.key };
      if (existing) body.jobId = existing.id;
      else body.jobName = name;
      await api("/api/rows", { method: "POST", body: JSON.stringify(body) });
      input.value = "";
      await loadJobs();
      await refresh();
    });
    addBtn.addEventListener("click", submitAdd);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitAdd();
    });
    addRow.appendChild(input);
    addRow.appendChild(addBtn);
    panel.appendChild(addRow);

    return panel;
  }

  function renderWeeks() {
    weeksContainer.innerHTML = "";

    let datalist = document.getElementById("jobNamesList");
    if (!datalist) {
      datalist = document.createElement("datalist");
      datalist.id = "jobNamesList";
      document.body.appendChild(datalist);
    }
    datalist.innerHTML = "";
    for (const j of state.jobs) {
      const opt = document.createElement("option");
      opt.value = j.name;
      datalist.appendChild(opt);
    }

    if (!state.weeks.length) {
      weeksContainer.innerHTML = '<div class="empty-schedule">No schedule data.</div>';
      return;
    }

    for (const week of state.weeks) {
      const section = document.createElement("section");
      section.className = "week-section";

      const head = document.createElement("div");
      head.className = "week-head";
      const h2 = document.createElement("h2");
      h2.textContent = week.label;
      head.appendChild(h2);
      section.appendChild(head);

      const cols = document.createElement("div");
      cols.className = "week-cols";
      for (const panelDef of PANELS) cols.appendChild(panelEl(week, panelDef));
      section.appendChild(cols);

      weeksContainer.appendChild(section);
    }
  }

  async function refresh() {
    await Promise.all([loadWorkers(), loadSchedule()]);
    renderLegend();
    renderWeeks();
    weekPicker.value = state.weekStart;
  }

  // --- nav controls ---
  document.getElementById("prevWeekBtn").addEventListener("click", guarded(async () => {
    state.weekStart = addDays(state.weekStart, -7);
    await refresh();
  }));
  document.getElementById("nextWeekBtn").addEventListener("click", guarded(async () => {
    state.weekStart = addDays(state.weekStart, 7);
    await refresh();
  }));
  document.getElementById("todayBtn").addEventListener("click", guarded(async () => {
    state.weekStart = mondayOf(localTodayStr());
    await refresh();
  }));
  weekPicker.addEventListener("change", guarded(async () => {
    if (!weekPicker.value) return;
    state.weekStart = mondayOf(weekPicker.value);
    await refresh();
  }));
  document.getElementById("exportPdfBtn").addEventListener("click", () => window.print());
  document.getElementById("exportJpgBtn").addEventListener("click", exportJpg);

  // --- JPG export: drawn straight from the loaded data, not a DOM screenshot ---
  function exportJpg() {
    const dayW = 132;
    const jobW = 190;
    const panelW = jobW + dayW * 5;
    const gap = 28;
    const margin = 24;
    const chipH = 22;
    const chipGap = 4;
    const rowPad = 10;
    const headerH = 26;
    const panelTitleH = 24;
    const weekTitleH = 30;

    function rowHeight(row) {
      const maxChips = Math.max(1, ...DAY_KEYS.map((d) => row.cells[d].length));
      return Math.max(34, rowPad * 2 + maxChips * chipH + (maxChips - 1) * chipGap);
    }

    let totalH = margin;
    const weekHeights = [];
    for (const week of state.weeks) {
      const mfgH = headerH + week.manufacturing.reduce((a, r) => a + rowHeight(r), 0);
      const instH = headerH + week.installing.reduce((a, r) => a + rowHeight(r), 0);
      const h = weekTitleH + panelTitleH + Math.max(mfgH, instH) + gap;
      weekHeights.push(h);
      totalH += h;
    }
    totalH += margin;

    const canvas = document.createElement("canvas");
    const scale = 2;
    canvas.width = (margin * 2 + panelW * 2 + gap) * scale;
    canvas.height = totalH * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = "#0a0607";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textBaseline = "middle";
    ctx.font = "600 12px Inter, system-ui, sans-serif";

    let y = margin;
    state.weeks.forEach((week, wi) => {
      ctx.fillStyle = "#e9e9ed";
      ctx.font = "700 16px Inter, system-ui, sans-serif";
      ctx.fillText(week.label, margin, y + 14);
      y += weekTitleH;

      [
        { key: "manufacturing", label: "MANUFACTURING", x: margin },
        { key: "installing", label: "INSTALLING", x: margin + panelW + gap },
      ].forEach(({ key, label, x }) => {
        let py = y;
        ctx.fillStyle = "#9184d9";
        ctx.font = "700 11px Inter, system-ui, sans-serif";
        ctx.fillText(label, x, py + 10);
        py += panelTitleH;

        ctx.strokeStyle = "#3f424d";
        ctx.fillStyle = "#9397ab";
        ctx.font = "600 10px Inter, system-ui, sans-serif";
        DAY_KEYS.forEach((day, i) => {
          ctx.fillText(DAY_LABELS[day].toUpperCase(), x + jobW + i * dayW + 6, py + headerH / 2);
        });
        ctx.beginPath();
        ctx.moveTo(x, py + headerH);
        ctx.lineTo(x + panelW, py + headerH);
        ctx.stroke();
        py += headerH;

        for (const row of week[key]) {
          const h = rowHeight(row);
          ctx.fillStyle = "#e9e9ed";
          ctx.font = "500 12px Inter, system-ui, sans-serif";
          ctx.fillText(row.jobName, x, py + h / 2, jobW - 10);

          DAY_KEYS.forEach((day, i) => {
            let cy = py + rowPad;
            for (const chip of row.cells[day]) {
              const cx = x + jobW + i * dayW + 4;
              const text = chip.name;
              ctx.font = "500 11px Inter, system-ui, sans-serif";
              const w = Math.min(dayW - 10, ctx.measureText(text).width + 14);
              ctx.fillStyle = chip.bg;
              roundRect(ctx, cx, cy, w, chipH - 4, 5);
              ctx.fill();
              ctx.fillStyle = chip.fg;
              ctx.fillText(text, cx + 7, cy + (chipH - 4) / 2, w - 12);
              cy += chipH;
            }
          });

          ctx.strokeStyle = "#232532";
          ctx.beginPath();
          ctx.moveTo(x, py + h);
          ctx.lineTo(x + panelW, py + h);
          ctx.stroke();
          py += h;
        }
      });

      y += weekHeights[wi] - weekTitleH;
    });

    canvas.toBlob(
      (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `schedule-${state.weeks[0].start}.jpg`;
        a.click();
        URL.revokeObjectURL(url);
      },
      "image/jpeg",
      0.92
    );
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // --- boot ---
  (async function init() {
    try {
      await loadJobs();
      await refresh();
    } catch (e) {
      weeksContainer.innerHTML = `<div class="empty-schedule">Couldn't load the schedule: ${e.message}</div>`;
    }
  })();
})();
