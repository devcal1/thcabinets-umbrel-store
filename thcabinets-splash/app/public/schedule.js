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
  // The local date the board was last successfully rendered for — drives the
  // midnight rollover check so an always-on TV doesn't keep highlighting
  // yesterday's column.
  let renderedToday = localTodayStr();

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
  // Australian date display, d/m and d/m/yy (e.g. 4/9/26), no zero padding.
  function fmtAUShort(s) {
    const d = parseDate(s);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  }
  function fmtAU(s) {
    const d = parseDate(s);
    return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(-2)}`;
  }
  // Built client-side (Mon–Fri range in AU format); the server's `label`
  // field is deliberately unused so date display stays a frontend concern.
  function weekRangeLabel(week) {
    return `${fmtAU(week.start)} – ${fmtAU(addDays(week.start, 4))}`;
  }

  // api(), toast(), guarded() now live in shared.js, loaded before this file.

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
  function openPopover(anchorEl, rowId, day) {
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
    // Unhide before measuring (display:none reads 0x0), then clamp to the
    // viewport — flipping above the anchor when there's no room below.
    const rect = anchorEl.getBoundingClientRect();
    popover.hidden = false;
    const pw = popover.offsetWidth;
    const ph = popover.offsetHeight;
    popover.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - pw - 8))}px`;
    const below = rect.bottom + 4;
    popover.style.top = `${below + ph > window.innerHeight ? Math.max(8, rect.top - ph - 4) : below}px`;
  }
  function closePopover() {
    popover.hidden = true;
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
    const notesBtn = iconBtn("ph-note-pencil", "Notes", () => toggleNotes(row.rowId));
    if (row.notes && row.notes.trim()) {
      notesBtn.classList.add("has-notes");
      rowDiv.classList.add("has-notes-row"); // drives the print-only marker
    }
    actions.appendChild(notesBtn);
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
      const flagged = !!(row.flags && row.flags[day]);
      const cell = document.createElement("div");
      cell.className = "sched-cell" + (i === todayIndex ? " today-col" : "") + (flagged ? " flagged" : "");
      const chips = document.createElement("div");
      chips.className = "sched-chips";
      for (const chip of row.cells[day]) chips.appendChild(chipEl(chip));
      cell.appendChild(chips);

      const controls = document.createElement("div");
      controls.className = "cell-controls";
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "cell-add";
      addBtn.textContent = "+";
      addBtn.title = "Add worker";
      addBtn.addEventListener("click", () => openPopover(addBtn, row.rowId, day));
      controls.appendChild(addBtn);

      if (panelKey === "installing") {
        const flagBtn = document.createElement("button");
        flagBtn.type = "button";
        flagBtn.className = "cell-flag" + (flagged ? " active" : "");
        flagBtn.title = flagged
          ? "Locked in with client — click to unflag"
          : "Flag as locked in with client";
        flagBtn.innerHTML = `<i class="ph ${flagged ? "ph-flag-fill" : "ph-flag"}"></i>`;
        flagBtn.addEventListener("click", guarded(async () => {
          if (flagged) {
            await api(`/api/rows/${row.rowId}/flags/${day}`, { method: "DELETE" });
          } else {
            await api(`/api/rows/${row.rowId}/flags`, { method: "POST", body: JSON.stringify({ day }) });
          }
          await refresh();
        }));
        controls.appendChild(flagBtn);
      }

      cell.appendChild(controls);
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
      // Notes are per-job, so the same job's icon in the other panel needs
      // updating too; renderWeeks' snapshot keeps this panel open through it.
      // Swallowed on failure — the save itself already stuck, and a toast here
      // would contradict "Notes saved"; the next action or tick re-syncs.
      try {
        await refresh();
      } catch {}
    }));
    notes.appendChild(saveBtn);
    // Dragging the textarea's resize handle changes the editor's height with
    // no event — keep the other panel's compensation margin in step.
    if (window.ResizeObserver) new ResizeObserver(queueSync).observe(notes);
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
    syncRowHeights();
  }

  // --- panel alignment ---
  // A job appearing in both panels of a week must sit on the same line, with
  // blank rows (null) padding the other panel. Anchors are the LCS of the two
  // panels' jobId sequences, so both panels' manual row order is respected —
  // if the orders conflict, the largest consistent set of jobs still aligns.
  // Unmatched rows between anchors pair up index-wise to keep the board short.
  function alignPanels(week) {
    const a = week.manufacturing;
    const b = week.installing;
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        dp[i][j] = a[i].jobId === b[j].jobId
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const outA = [];
    const outB = [];
    let segA = [];
    let segB = [];
    function flushSegments() {
      for (let k = 0; k < Math.max(segA.length, segB.length); k++) {
        outA.push(segA[k] || null);
        outB.push(segB[k] || null);
      }
      segA = [];
      segB = [];
    }
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i].jobId === b[j].jobId) {
        flushSegments();
        outA.push(a[i++]);
        outB.push(b[j++]);
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        segA.push(a[i++]);
      } else {
        segB.push(b[j++]);
      }
    }
    while (i < a.length) segA.push(a[i++]);
    while (j < b.length) segB.push(b[j++]);
    flushSegments();
    return { manufacturing: outA, installing: outB };
  }

  function blankRowEl(todayIndex) {
    const rowDiv = document.createElement("div");
    rowDiv.className = "sched-row row-blank";
    const jobCell = document.createElement("div");
    jobCell.className = "job-cell";
    rowDiv.appendChild(jobCell);
    DAY_KEYS.forEach((day, i) => {
      const cell = document.createElement("div");
      cell.className = "sched-cell" + (i === todayIndex ? " today-col" : "");
      rowDiv.appendChild(cell);
    });
    return rowDiv;
  }

  // The two panels are independent grids, so paired lines only stay level if
  // we measure and match their heights (chips stack, names wrap). An open
  // notes editor adds height below its row; the margin compensates on the
  // other panel so lines further down stay aligned while someone types.
  function openNotesHeight(rowDiv) {
    const next = rowDiv.nextElementSibling;
    return next && next.classList.contains("job-notes") && !next.hidden ? next.offsetHeight : 0;
  }
  function syncRowHeights() {
    // The sticky week banner sits below the nav; nav height varies with
    // flex-wrap, so measure it into the CSS var the banner's `top` uses.
    // This runs on render/resize/fonts-ready — the same times it can change.
    document.documentElement.style.setProperty("--nav-h", `${document.querySelector(".nav").offsetHeight}px`);
    const stacked = window.matchMedia("(max-width: 900px)").matches;
    const pairs = [];
    for (const section of weeksContainer.querySelectorAll(".week-section")) {
      const grids = section.querySelectorAll(".panel .sched-grid");
      if (grids.length < 2) continue;
      const rowsA = [...grids[0].querySelectorAll(".sched-row:not(.sched-head)")];
      const rowsB = [...grids[1].querySelectorAll(".sched-row:not(.sched-head)")];
      for (const r of [...rowsA, ...rowsB]) {
        r.style.minHeight = "";
        r.style.marginBottom = "";
      }
      // Panels stack below 900px (blank rows are hidden there too) — pairing
      // by line no longer means anything visually, so leave heights natural.
      if (stacked) continue;
      for (let k = 0; k < Math.min(rowsA.length, rowsB.length); k++) pairs.push([rowsA[k], rowsB[k]]);
    }
    // All reads before all writes: one forced layout per call, not per pair —
    // this runs after every mutation on a TV-grade device.
    const measured = pairs.map(([a, b]) => ({
      a,
      b,
      h: Math.max(a.offsetHeight, b.offsetHeight),
      na: openNotesHeight(a),
      nb: openNotesHeight(b),
    }));
    for (const m of measured) {
      m.a.style.minHeight = `${m.h}px`;
      m.b.style.minHeight = `${m.h}px`;
      if (m.na !== m.nb) (m.na > m.nb ? m.b : m.a).style.marginBottom = `${Math.abs(m.na - m.nb)}px`;
    }
  }
  let syncTimer;
  function queueSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncRowHeights, 120);
  }

  // --- panel rendering ---
  function panelEl(week, panelDef, rows) {
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
      d.textContent = `${DAY_LABELS[day]} ${fmtAUShort(addDays(week.start, i))}`;
      head.appendChild(d);
    });
    grid.appendChild(head);

    for (const row of rows) {
      grid.appendChild(row ? rowEl(row, panelDef.key, todayIndex) : blankRowEl(todayIndex));
    }

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
    // The rebuild below wipes every notes panel — snapshot the open ones (and
    // any unsaved draft text) so a chip/flag edit elsewhere can't destroy them.
    const openNotes = new Map();
    for (const el of weeksContainer.querySelectorAll(".job-notes:not([hidden])")) {
      openNotes.set(el.id, el.querySelector("textarea").value);
    }

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
      h2.textContent = weekRangeLabel(week);
      head.appendChild(h2);
      section.appendChild(head);

      const cols = document.createElement("div");
      cols.className = "week-cols";
      const aligned = alignPanels(week);
      for (const panelDef of PANELS) cols.appendChild(panelEl(week, panelDef, aligned[panelDef.key]));
      section.appendChild(cols);

      weeksContainer.appendChild(section);
    }

    for (const [id, draft] of openNotes) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.hidden = false;
      const textarea = el.querySelector("textarea");
      if (textarea.value !== draft) textarea.value = draft;
    }

    syncRowHeights();
  }

  async function refresh() {
    // jobs included so a rename can't leave the add-job autocomplete offering
    // stale names (which silently creates duplicate jobs server-side).
    await Promise.all([loadWorkers(), loadJobs(), loadSchedule()]);
    renderedToday = localTodayStr();
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
    if (!state.weeks.length) {
      toast("Nothing to export yet");
      return;
    }
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

    // Mirrors the on-screen alignment: one shared height per line, both panels.
    const alignedWeeks = state.weeks.map((week) => alignPanels(week));
    const weekLines = alignedWeeks.map((aligned) =>
      aligned.manufacturing.map((r, i) => {
        const b = aligned.installing[i];
        return Math.max(r ? rowHeight(r) : 34, b ? rowHeight(b) : 34);
      })
    );

    let totalH = margin;
    const weekHeights = [];
    for (const lines of weekLines) {
      const bodyH = headerH + lines.reduce((a, h) => a + h, 0);
      const h = weekTitleH + panelTitleH + bodyH + gap;
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
      ctx.fillText(weekRangeLabel(week), margin, y + 14);
      // Mirrors the board's accent week banner — a hard rule marking where
      // each week starts.
      ctx.strokeStyle = "#9184d9";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(margin, y + 26);
      ctx.lineTo(margin + panelW * 2 + gap, y + 26);
      ctx.stroke();
      ctx.lineWidth = 1;
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
          ctx.fillText(`${DAY_LABELS[day].toUpperCase()} ${fmtAUShort(addDays(week.start, i))}`, x + jobW + i * dayW + 6, py + headerH / 2);
        });
        ctx.beginPath();
        ctx.moveTo(x, py + headerH);
        ctx.lineTo(x + panelW, py + headerH);
        ctx.stroke();
        py += headerH;

        alignedWeeks[wi][key].forEach((row, li) => {
          const h = weekLines[wi][li];
          if (row) {
            const hasNotes = !!(row.notes && row.notes.trim());
            ctx.fillStyle = "#e9e9ed";
            ctx.font = "500 12px Inter, system-ui, sans-serif";
            ctx.fillText(row.jobName, x, py + h / 2, hasNotes ? jobW - 24 : jobW - 10);
            if (hasNotes) {
              // Mirrors the board's orange notes icon.
              ctx.fillStyle = "#ff8c1a";
              ctx.beginPath();
              ctx.arc(x + jobW - 12, py + h / 2, 3.5, 0, Math.PI * 2);
              ctx.fill();
            }

            DAY_KEYS.forEach((day, i) => {
              const cellX = x + jobW + i * dayW;
              if (key === "installing" && row.flags && row.flags[day]) {
                ctx.fillStyle = "rgba(232, 179, 57, 0.12)";
                ctx.fillRect(cellX, py, dayW, h);
                ctx.fillStyle = "#e8b339";
                ctx.fillRect(cellX, py, 3, h);
              }
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
          }

          ctx.strokeStyle = "#232532";
          ctx.beginPath();
          ctx.moveTo(x, py + h);
          ctx.lineTo(x + panelW, py + h);
          ctx.stroke();
          py += h;
        });
      });

      y += weekHeights[wi] - weekTitleH;
    });

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          toast("Export failed");
          return;
        }
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

  // Row-height pairing depends on wrapping, so re-measure when the viewport
  // changes — and once the web font lands, since it shifts text metrics.
  window.addEventListener("resize", queueSync);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncRowHeights);

  // The board lives on an always-on workshop TV: once the local date rolls
  // over, re-render so the today highlight moves — and if the viewer was on
  // the current week, re-anchor so a new week surfaces on Monday morning.
  setInterval(async () => {
    const now = localTodayStr();
    if (now === renderedToday) return;
    try {
      if (state.weekStart === mondayOf(renderedToday)) state.weekStart = mondayOf(now);
      await refresh();
    } catch {
      // Server may be mid-restart overnight; renderedToday only advances on a
      // successful refresh, so the next tick retries.
    }
  }, 60000);

  // --- boot ---
  (async function init() {
    try {
      await refresh();
    } catch (e) {
      weeksContainer.innerHTML = `<div class="empty-schedule">Couldn't load the schedule: ${e.message}</div>`;
    }
  })();
})();
