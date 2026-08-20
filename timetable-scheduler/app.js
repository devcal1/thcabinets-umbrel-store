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
    const anchorSlot = mode === "resize-top" ? block.end : mode === "resize-bottom" ? block.start : block.start;
    const [lo, hi] = getFreeRange(block.day, anchorSlot, blockId);

    dragState = {
      mode, el, block, rect, lo, hi,
      origStart: block.start, origEnd: block.end,
      startY: e.clientY, moved: false,
    };

    el.setPointerCapture(e.pointerId);
    el.style.cursor = mode === "move" ? "grabbing" : "ns-resize";
    el.addEventListener("pointermove", onBlockPointerMove);
    el.addEventListener("pointerup", onBlockPointerUp);
    el.addEventListener("pointercancel", onBlockPointerUp);
  }

  function onBlockPointerMove(e) {
    if (!dragState || dragState.mode === "create") return;
    const { mode, block, rect, lo, hi, origStart, origEnd, startY } = dragState;
    const deltaSlots = Math.round((e.clientY - startY) / ROW_H);
    if (deltaSlots !== 0) dragState.moved = true;

    if (mode === "move") {
      const length = origEnd - origStart;
      let newStart = clamp(origStart + deltaSlots, lo, hi - length);
      block.start = newStart;
      block.end = newStart + length;
    } else if (mode === "resize-top") {
      let newStart = clamp(origStart + deltaSlots, lo, origEnd - 1);
      block.start = newStart;
    } else if (mode === "resize-bottom") {
      let newEnd = clamp(origEnd + deltaSlots, origStart + 1, hi);
      block.end = newEnd;
    }
    positionBlockEl(dragState.el, block);
    const timeEl = dragState.el.querySelector(".block-time");
    if (timeEl) timeEl.textContent = `${slotToLabel(block.start)} – ${slotToLabel(block.end)}`;
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
