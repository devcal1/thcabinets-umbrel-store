(() => {
  "use strict";

  // ---- Config ----------------------------------------------------------
  const START_HOUR = 5;      // 5am
  const END_HOUR = 22;       // 10pm
  const SLOT_MIN = 30;
  const SLOTS_PER_HOUR = 60 / SLOT_MIN;
  const SLOT_COUNT = (END_HOUR - START_HOUR) * SLOTS_PER_HOUR; // 34
  const ROW_H = 22; // px, must match --row-h in style.css (per 30-min slot)

  const DAY_NAMES = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
  const DAYS = [
    ...DAY_NAMES.map((n, i) => ({ id: `${i}A`, name: n, week: "A" })),
    ...DAY_NAMES.map((n, i) => ({ id: `${i}B`, name: n, week: "B" })),
  ];

  const STORAGE_KEY = "th_timetable_v1";

  const DEFAULT_TASKS = [
    { id: "t1", name: "Work / Quoting", color: "#3b6ea5" },
    { id: "t2", name: "Work / Quoting & Ordering", color: "#2c4f78" },
    { id: "t3", name: "Ordering", color: "#5c8fc9" },
    { id: "t4", name: "Scheduling", color: "#7fa6c9" },
    { id: "t5", name: "Site Consult", color: "#e07b2a" },
    { id: "t6", name: "Showroom Consult", color: "#d1499a" },
    { id: "t7", name: "Evening Work", color: "#34547a" },
    { id: "t8", name: "Systems / Process Work", color: "#2fa190" },
    { id: "t9", name: "Gym", color: "#c0392b" },
    { id: "t10", name: "Morning Walk", color: "#45b26b" },
    { id: "t11", name: "Golf Driving Range", color: "#2fb6b0" },
    { id: "t12", name: "Dinner w/ Friends", color: "#8b5fd6" },
    { id: "t13", name: "Dinner w/ Nana", color: "#c04fd1" },
    { id: "t14", name: "Cards", color: "#6a56c9" },
  ];

  // ---- State -------------------------------------------------------------
  let state = loadState();
  let activeTaskId = state.tasks[0] ? state.tasks[0].id : null;
  let selectedBlockId = null;
  let editingTaskId = null; // null = "add" mode when task-form is open

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.tasks) && Array.isArray(parsed.blocks)) return parsed;
      }
    } catch (e) { /* fall through to default */ }
    return { tasks: DEFAULT_TASKS.map(t => ({ ...t })), blocks: [] };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function uid(prefix) {
    return prefix + Math.random().toString(36).slice(2, 9);
  }

  // ---- Time formatting -----------------------------------------------------
  function slotToLabel(slot) {
    const totalMin = START_HOUR * 60 + slot * SLOT_MIN;
    let hour24 = Math.floor(totalMin / 60);
    const min = totalMin % 60;
    const ampm = hour24 < 12 || hour24 === 24 ? "am" : "pm";
    let hour12 = hour24 % 12;
    if (hour12 === 0) hour12 = 12;
    return min === 0 ? `${hour12}${ampm}` : `${hour12}:${String(min).padStart(2, "0")}${ampm}`;
  }

  // ---- DOM refs ------------------------------------------------------------
  const paletteEl = document.getElementById("palette");
  const scheduleInner = document.getElementById("schedule-inner");
  const taskForm = document.getElementById("task-form");
  const taskFormName = document.getElementById("task-form-name");
  const taskFormColor = document.getElementById("task-form-color");
  const taskFormDelete = document.getElementById("task-form-delete");
  const hintText = document.getElementById("hint-text");

  // ---- Build static grid skeleton (headers + gutter + day columns) --------
  function buildGrid() {
    scheduleInner.innerHTML = "";

    const headerRow = document.createElement("div");
    headerRow.className = "header-row";
    const corner = document.createElement("div");
    corner.className = "corner-cell";
    headerRow.appendChild(corner);

    DAYS.forEach(day => {
      const h = document.createElement("div");
      h.className = "day-header" + (day.week === "B" ? " week-b" : "");
      h.innerHTML = `<div class="day-name">${day.name}</div><div class="week-label">WEEK ${day.week}</div>`;
      headerRow.appendChild(h);
    });
    scheduleInner.appendChild(headerRow);

    const bodyRow = document.createElement("div");
    bodyRow.className = "body-row";

    const gutter = document.createElement("div");
    gutter.className = "time-gutter";
    for (let s = 0; s < SLOT_COUNT; s += SLOTS_PER_HOUR) {
      const lbl = document.createElement("div");
      lbl.className = "time-label";
      lbl.textContent = slotToLabel(s);
      gutter.appendChild(lbl);
    }
    bodyRow.appendChild(gutter);

    DAYS.forEach(day => {
      const col = document.createElement("div");
      col.className = "day-col" + (day.week === "B" ? " week-b" : "");
      col.dataset.day = day.id;
      col.style.height = (SLOT_COUNT * ROW_H) + "px";
      col.addEventListener("pointerdown", onColumnPointerDown);
      bodyRow.appendChild(col);
    });

    scheduleInner.appendChild(bodyRow);
  }

  function getColumnEl(dayId) {
    return scheduleInner.querySelector(`.day-col[data-day="${dayId}"]`);
  }

  // ---- Render blocks ---------------------------------------------------
  function renderBlocks() {
    DAYS.forEach(day => {
      const col = getColumnEl(day.id);
      col.querySelectorAll(".block").forEach(el => el.remove());
      const dayBlocks = state.blocks.filter(b => b.day === day.id);
      dayBlocks.forEach(b => col.appendChild(buildBlockEl(b)));
    });
  }

  function taskById(id) {
    return state.tasks.find(t => t.id === id);
  }

  function buildBlockEl(block) {
    const task = taskById(block.taskId) || { name: "(deleted task)", color: "#555" };
    const el = document.createElement("div");
    el.className = "block";
    el.dataset.id = block.id;
    positionBlockEl(el, block);
    el.style.background = task.color;
    el.innerHTML = `
      <div class="handle handle-top" data-role="resize-top"></div>
      <div class="block-name">${escapeHtml(task.name)}</div>
      <div class="block-time">${slotToLabel(block.start)} – ${slotToLabel(block.end)}</div>
      <div class="delete-btn" data-role="delete">×</div>
      <div class="handle handle-bottom" data-role="resize-bottom"></div>
    `;
    el.addEventListener("pointerdown", onBlockPointerDown);
    return el;
  }

  function positionBlockEl(el, block) {
    el.style.top = (block.start * ROW_H) + "px";
    el.style.height = ((block.end - block.start) * ROW_H) + "px";
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---- Free-range helper (collision handling) -------------------------
  function getFreeRange(dayId, anchorSlot, excludeBlockId) {
    const dayBlocks = state.blocks
      .filter(b => b.day === dayId && b.id !== excludeBlockId)
      .sort((a, b) => a.start - b.start);
    let lo = 0, hi = SLOT_COUNT;
    for (const b of dayBlocks) {
      if (b.end <= anchorSlot) lo = Math.max(lo, b.end);
      else if (b.start >= anchorSlot) { hi = Math.min(hi, b.start); break; }
    }
    return [lo, hi];
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // ---- Palette -----------------------------------------------------------
  function renderPalette() {
    paletteEl.innerHTML = "";
    state.tasks.forEach(task => {
      const chip = document.createElement("div");
      chip.className = "task-chip" + (task.id === activeTaskId ? " active" : "");
      chip.innerHTML = `<span class="swatch" style="background:${task.color}"></span><span>${escapeHtml(task.name)}</span><span class="edit-btn" title="Edit">✎</span>`;
      chip.addEventListener("click", (e) => {
        if (e.target.classList.contains("edit-btn")) {
          openTaskForm(task.id);
        } else {
          activeTaskId = task.id;
          renderPalette();
        }
      });
      paletteEl.appendChild(chip);
    });
  }

  function openTaskForm(taskId) {
    editingTaskId = taskId;
    taskForm.classList.remove("hidden");
    if (taskId) {
      const t = taskById(taskId);
      taskFormName.value = t.name;
      taskFormColor.value = t.color;
      taskFormDelete.classList.remove("hidden");
    } else {
      taskFormName.value = "";
      taskFormColor.value = "#3b6ea5";
      taskFormDelete.classList.add("hidden");
    }
    taskFormName.focus();
  }

  function closeTaskForm() {
    taskForm.classList.add("hidden");
    editingTaskId = null;
  }

  document.getElementById("btn-add-task").addEventListener("click", () => openTaskForm(null));
  document.getElementById("task-form-cancel").addEventListener("click", closeTaskForm);

  document.getElementById("task-form-save").addEventListener("click", () => {
    const name = taskFormName.value.trim();
    const color = taskFormColor.value;
    if (!name) { taskFormName.focus(); return; }
    if (editingTaskId) {
      const t = taskById(editingTaskId);
      t.name = name;
      t.color = color;
    } else {
      const t = { id: uid("t"), name, color };
      state.tasks.push(t);
      activeTaskId = t.id;
    }
    saveState();
    renderPalette();
    renderBlocks();
    closeTaskForm();
  });

  taskFormDelete.addEventListener("click", () => {
    if (!editingTaskId) return;
    const inUse = state.blocks.some(b => b.taskId === editingTaskId);
    if (inUse && !confirm("This task is used by existing blocks. Delete the task and all its blocks?")) return;
    state.blocks = state.blocks.filter(b => b.taskId !== editingTaskId);
    state.tasks = state.tasks.filter(t => t.id !== editingTaskId);
    if (activeTaskId === editingTaskId) activeTaskId = state.tasks[0] ? state.tasks[0].id : null;
    saveState();
    renderPalette();
    renderBlocks();
    closeTaskForm();
  });

  // ---- Create (click-drag on empty column) --------------------------------
  let dragState = null; // shared for create / move / resize

  function onColumnPointerDown(e) {
    if (e.target !== e.currentTarget) return; // ignore clicks that bubbled from a block
    if (!activeTaskId) {
      flashHint("Select or add a task first, then drag on the grid.");
      return;
    }
    const col = e.currentTarget;
    const dayId = col.dataset.day;
    const rect = col.getBoundingClientRect();
    const anchorSlot = clamp(Math.floor((e.clientY - rect.top) / ROW_H), 0, SLOT_COUNT - 1);
    const [lo, hi] = getFreeRange(dayId, anchorSlot, null);
    if (hi - lo <= 0) return;

    const preview = document.createElement("div");
    preview.className = "drag-preview";
    col.appendChild(preview);

    dragState = { mode: "create", dayId, col, rect, anchorSlot, lo, hi, preview };
    updateCreatePreview(anchorSlot);

    col.setPointerCapture(e.pointerId);
    col.addEventListener("pointermove", onColumnPointerMove);
    col.addEventListener("pointerup", onColumnPointerUp);
    col.addEventListener("pointercancel", onColumnPointerUp);
  }

  function onColumnPointerMove(e) {
    if (!dragState || dragState.mode !== "create") return;
    const { rect, lo, hi } = dragState;
    let slot = Math.floor((e.clientY - rect.top) / ROW_H);
    slot = clamp(slot, lo, hi - 1);
    updateCreatePreview(slot);
  }

  function updateCreatePreview(currentSlot) {
    const { anchorSlot, preview } = dragState;
    const start = Math.min(anchorSlot, currentSlot);
    const end = Math.max(anchorSlot, currentSlot) + 1;
    dragState.previewStart = start;
    dragState.previewEnd = end;
    preview.style.top = (start * ROW_H) + "px";
    preview.style.height = ((end - start) * ROW_H) + "px";
  }

  function onColumnPointerUp(e) {
    if (!dragState || dragState.mode !== "create") return;
    const { col, dayId, previewStart, previewEnd, preview } = dragState;
    col.removeEventListener("pointermove", onColumnPointerMove);
    col.removeEventListener("pointerup", onColumnPointerUp);
    col.removeEventListener("pointercancel", onColumnPointerUp);
    preview.remove();

    if (previewEnd > previewStart) {
      const block = { id: uid("b"), day: dayId, start: previewStart, end: previewEnd, taskId: activeTaskId };
      state.blocks.push(block);
      saveState();
      renderBlocks();
    }
    dragState = null;
  }

  // ---- Move / resize existing blocks --------------------------------------
  function onBlockPointerDown(e) {
    const el = e.currentTarget;
    const blockId = el.dataset.id;
    const block = state.blocks.find(b => b.id === blockId);
    if (!block) return;

    const role = e.target.dataset.role;
    if (role === "delete") {
      e.stopPropagation();
      state.blocks = state.blocks.filter(b => b.id !== blockId);
      if (selectedBlockId === blockId) selectedBlockId = null;
      saveState();
      renderBlocks();
      return;
    }

    e.stopPropagation();
    selectBlock(blockId);

    const col = getColumnEl(block.day);
    const rect = col.getBoundingClientRect();
    const mode = role === "resize-top" ? "resize-top" : role === "resize-bottom" ? "resize-bottom" : "move";

    dragState = {
      mode, el, block, rect,
      origDay: block.day, origStart: block.start, origEnd: block.end,
      grabOffsetY: e.clientY - rect.top - block.start * ROW_H,
      startY: e.clientY, moved: false,
    };

    if (mode !== "move") {
      const anchorSlot = mode === "resize-top" ? block.end : block.start;
      const [lo, hi] = getFreeRange(block.day, anchorSlot, blockId);
      dragState.lo = lo;
      dragState.hi = hi;
    }

    el.setPointerCapture(e.pointerId);
    el.style.cursor = mode === "move" ? "grabbing" : "ns-resize";
    el.addEventListener("pointermove", onBlockPointerMove);
    el.addEventListener("pointerup", onBlockPointerUp);
    el.addEventListener("pointercancel", onBlockPointerUp);
  }

  function onBlockPointerMove(e) {
    if (!dragState || dragState.mode === "create") return;
    const { mode, block, origStart, origEnd, startY } = dragState;
    const deltaSlots = Math.round((e.clientY - startY) / ROW_H);
    if (deltaSlots !== 0) dragState.moved = true;

    if (mode === "move") {
      moveBlockToPointer(e);
    } else if (mode === "resize-top") {
      const { lo, hi } = dragState;
      let newStart = clamp(origStart + deltaSlots, lo, origEnd - 1);
      block.start = newStart;
    } else if (mode === "resize-bottom") {
      const { lo, hi } = dragState;
      let newEnd = clamp(origEnd + deltaSlots, origStart + 1, hi);
      block.end = newEnd;
    }
    positionBlockEl(dragState.el, block);
    const timeEl = dragState.el.querySelector(".block-time");
    if (timeEl) timeEl.textContent = `${slotToLabel(block.start)} – ${slotToLabel(block.end)}`;
  }

  // Cross-day move: figure out which day column the pointer is currently over
  // (ignoring the dragged block itself) and reposition/re-parent accordingly.
  function moveBlockToPointer(e) {
    const { block, el, grabOffsetY, origStart, origEnd } = dragState;
    const length = origEnd - origStart;

    el.style.pointerEvents = "none";
    const under = document.elementFromPoint(e.clientX, e.clientY);
    el.style.pointerEvents = "";
    const targetCol = under && under.closest(".day-col");
    const targetDayId = targetCol ? targetCol.dataset.day : block.day;
    const col = getColumnEl(targetDayId);
    const rect = col.getBoundingClientRect();

    const rawStart = Math.round((e.clientY - rect.top - grabOffsetY) / ROW_H);
    const anchor = clamp(rawStart, 0, SLOT_COUNT - 1);
    const [lo, hi] = getFreeRange(targetDayId, anchor, block.id);
    const newStart = clamp(rawStart, lo, Math.max(lo, hi - length));

    if (targetDayId !== block.day) {
      block.day = targetDayId;
      col.appendChild(el);
    }
    block.start = newStart;
    block.end = newStart + length;
  }

  function onBlockPointerUp(e) {
    if (!dragState || dragState.mode === "create") return;
    const { el } = dragState;
    el.removeEventListener("pointermove", onBlockPointerMove);
    el.removeEventListener("pointerup", onBlockPointerUp);
    el.removeEventListener("pointercancel", onBlockPointerUp);
    el.style.cursor = "grab";
    saveState();
    dragState = null;
  }

  function selectBlock(id) {
    selectedBlockId = id;
  }

  // ---- Global key handling (delete selected block, escape) ---------------
  document.addEventListener("keydown", (e) => {
    if ((e.key === "Delete" || e.key === "Backspace") && selectedBlockId && document.activeElement.tagName !== "INPUT") {
      state.blocks = state.blocks.filter(b => b.id !== selectedBlockId);
      selectedBlockId = null;
      saveState();
      renderBlocks();
    }
    if (e.key === "Escape") {
      selectedBlockId = null;
      closeTaskForm();
    }
  });

  let hintTimer = null;
  function flashHint(msg) {
    hintText.textContent = msg;
    hintText.style.color = "#e88a80";
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hintText.textContent = "Select a task above, then click-drag on the grid to block out time. Drag a block's middle to move it, its top/bottom edge to resize, or hover it and hit the × to remove it.";
      hintText.style.color = "";
    }, 2500);
  }

  // ---- Copy Week A -> Week B -----------------------------------------------
  document.getElementById("btn-copy-week").addEventListener("click", () => {
    const weekBHasBlocks = state.blocks.some(b => b.day.endsWith("B"));
    const msg = weekBHasBlocks
      ? "This replaces every Week B block with a copy of the matching Week A day. Continue?"
      : "Copy every Week A block into Week B?";
    if (!confirm(msg)) return;
    state.blocks = state.blocks.filter(b => !b.day.endsWith("B"));
    const toAdd = state.blocks
      .filter(b => b.day.endsWith("A"))
      .map(b => ({ id: uid("b"), day: b.day.replace("A", "B"), start: b.start, end: b.end, taskId: b.taskId }));
    state.blocks = state.blocks.concat(toAdd);
    selectedBlockId = null;
    saveState();
    renderBlocks();
  });

  // ---- Export to JPG (drawn from state, not a DOM screenshot) -------------
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function clipText(ctx, text, x, y, maxWidth) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y - 2, maxWidth, 16);
    ctx.clip();
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function buildScheduleCanvas() {
    const scale = 2;
    const colW = 130, gutterW = 64, rowH = 24, headerH = 40, titleH = 50;
    const legendCols = 4;
    const legendRowH = 20;
    const legendRows = Math.ceil(state.tasks.length / legendCols) || 1;
    const legendH = 26 + legendRows * legendRowH;
    const gridH = SLOT_COUNT * rowH;
    const width = gutterW + DAYS.length * colW;
    const height = titleH + headerH + gridH + legendH;

    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.textBaseline = "top";

    ctx.fillStyle = "#14181f";
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#e8ecf2";
    ctx.font = "bold 18px -apple-system, Segoe UI, Arial, sans-serif";
    ctx.fillText("TH CABINETS — FORTNIGHTLY SCHEDULE", 16, 12);
    ctx.fillStyle = "#98a2b3";
    ctx.font = "11px -apple-system, Segoe UI, Arial, sans-serif";
    ctx.fillText("Generated " + new Date().toLocaleDateString(), 16, 34);

    const headerY = titleH;
    DAYS.forEach((day, i) => {
      const x = gutterW + i * colW;
      ctx.fillStyle = day.week === "B" ? "#262d3c" : "#232a36";
      ctx.fillRect(x, headerY, colW, headerH);
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.strokeRect(x + 0.5, headerY + 0.5, colW - 1, headerH - 1);
      ctx.fillStyle = "#e8ecf2";
      ctx.font = "bold 12px -apple-system, Segoe UI, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(day.name, x + colW / 2, headerY + 8);
      ctx.font = "9px -apple-system, Segoe UI, Arial, sans-serif";
      ctx.fillStyle = "#98a2b3";
      ctx.fillText("WEEK " + day.week, x + colW / 2, headerY + 24);
      ctx.textAlign = "left";
    });

    const gridTop = headerY + headerH;

    DAYS.forEach((day, i) => {
      const x = gutterW + i * colW;
      if (day.week === "B") {
        ctx.fillStyle = "rgba(255,255,255,0.02)";
        ctx.fillRect(x, gridTop, colW, gridH);
      }
    });

    for (let s = 0; s <= SLOT_COUNT; s++) {
      const y = gridTop + s * rowH;
      ctx.strokeStyle = s % 2 === 0 ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.moveTo(gutterW, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      if (s % 2 === 0 && s < SLOT_COUNT) {
        ctx.fillStyle = "#98a2b3";
        ctx.font = "10px -apple-system, Segoe UI, Arial, sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(slotToLabel(s), gutterW - 6, y + 3);
        ctx.textAlign = "left";
      }
    }

    for (let i = 0; i <= DAYS.length; i++) {
      const x = gutterW + i * colW;
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.beginPath();
      ctx.moveTo(x, headerY);
      ctx.lineTo(x, gridTop + gridH);
      ctx.stroke();
    }

    state.blocks.forEach(b => {
      const dayIdx = DAYS.findIndex(d => d.id === b.day);
      const task = taskById(b.taskId);
      if (dayIdx < 0 || !task) return;
      const x = gutterW + dayIdx * colW + 2;
      const y = gridTop + b.start * rowH;
      const h = (b.end - b.start) * rowH;
      ctx.fillStyle = task.color;
      roundRect(ctx, x, y, colW - 4, h, 3);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1;
      roundRect(ctx, x + 0.5, y + 0.5, colW - 5, Math.max(h - 1, 1), 3);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 10px -apple-system, Segoe UI, Arial, sans-serif";
      clipText(ctx, task.name, x + 5, y + 4, colW - 10);
      if (h > 18) {
        ctx.font = "9px -apple-system, Segoe UI, Arial, sans-serif";
        clipText(ctx, `${slotToLabel(b.start)} – ${slotToLabel(b.end)}`, x + 5, y + 16, colW - 10);
      }
    });

    let ly = gridTop + gridH + 20;
    ctx.font = "10px -apple-system, Segoe UI, Arial, sans-serif";
    const legendColW = width / legendCols;
    state.tasks.forEach((t, i) => {
      const col = i % legendCols, row = Math.floor(i / legendCols);
      const x = 16 + col * legendColW;
      const y = ly + row * legendRowH;
      ctx.fillStyle = t.color;
      ctx.fillRect(x, y + 2, 10, 10);
      ctx.fillStyle = "#e8ecf2";
      clipText(ctx, t.name, x + 16, y + 2, legendColW - 24);
    });

    return canvas;
  }

  document.getElementById("btn-export-jpg").addEventListener("click", () => {
    const canvas = buildScheduleCanvas();
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `th-cabinets-schedule-${new Date().toISOString().slice(0, 10)}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, "image/jpeg", 0.92);
  });

  // ---- Export to PDF (browser print -> Save as PDF) ------------------------
  document.getElementById("btn-export-pdf").addEventListener("click", () => {
    window.print();
  });

  // ---- Export / Import / Clear --------------------------------------------
  document.getElementById("btn-export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `th-cabinets-schedule-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  const fileImport = document.getElementById("file-import");
  document.getElementById("btn-import").addEventListener("click", () => fileImport.click());
  fileImport.addEventListener("change", () => {
    const file = fileImport.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed.tasks) || !Array.isArray(parsed.blocks)) throw new Error("bad shape");
        if (!confirm("Import will replace your current schedule and task list. Continue?")) return;
        state = parsed;
        activeTaskId = state.tasks[0] ? state.tasks[0].id : null;
        selectedBlockId = null;
        saveState();
        renderPalette();
        renderBlocks();
      } catch (err) {
        alert("Could not read that file — it doesn't look like a valid schedule export.");
      }
    };
    reader.readAsText(file);
    fileImport.value = "";
  });

  document.getElementById("btn-clear").addEventListener("click", () => {
    if (!confirm("Remove every block from the schedule? Tasks/colours will be kept.")) return;
    state.blocks = [];
    selectedBlockId = null;
    saveState();
    renderBlocks();
  });

  // ---- Init ----------------------------------------------------------------
  buildGrid();
  renderPalette();
  renderBlocks();
})();
