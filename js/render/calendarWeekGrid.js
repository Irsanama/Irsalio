/**
 * @file Рендеринг недельного календаря (Week Grid).
 * @description Отрисовка 24-часовой сетки на 7 дней, кластеризация пересекающихся задач,
 *              поддержка многодневных задач, Drag-and-Drop и тултипы.
 */

import { el } from "../core/dom.js";
import {
  parseLocalDate,
  dateKey,
  getMinutesSinceMidnight,
  addMinutes,
  addDays,
  snapToGrid,
  formatTimeRange,
  toDatetimeLocalValue,
} from "../core/dates.js";
import { state, WEEKDAYS } from "../state/state.js";
import { openTaskPanel } from "../features/taskPanel.js";
import { api } from "../storage/api.js";


const HOUR_HEIGHT = 60;
const GRID_HOURS = 24;
const GRID_HEIGHT = HOUR_HEIGHT * GRID_HOURS;
const SNAP_MINUTES = 15;
const MIN_BLOCK_HEIGHT = 24;
const MIN_BLOCK_MINUTES = 30;
const DRAG_THRESHOLD = 5;
const TIME_SCALE_WIDTH = 32;
const BLOCK_SIDE_GAP = 3;
const LONG_PRESS_MS = 400;


let timeIndicatorInterval = null;
let activePlusEl = null;
let dragState = null;
let isGlobalDocListenersAttached = false;

/** Удаляет кнопку «+» из ячейки, если она активна. */
function removeActivePlus() {
  if (activePlusEl && activePlusEl.parentNode) {
    activePlusEl.parentNode.removeChild(activePlusEl);
  }
  activePlusEl = null;
}


/**
 * Преобразует минуты от начала суток в пиксели.
 * @param {number} m - Минуты.
 * @returns {number} Пиксели.
 */
function minutesToPx(m) {
  return (m / 60) * HOUR_HEIGHT;
}

/**
 * Преобразует пиксели в минуты от начала суток.
 * @param {number} px - Пиксели.
 * @returns {number} Минуты.
 */
function pxToMinutes(px) {
  return (px / HOUR_HEIGHT) * 60;
}

/**
 * Возвращает CSS-цвет в зависимости от статуса срока.
 * @param {string} s - Статус ('overdue', 'due-soon', 'normal').
 * @returns {string} CSS-переменная цвета.
 */
function getStateColor(s) {
  if (s === "overdue") return "var(--danger)";
  if (s === "due-soon") return "var(--warning)";
  return "var(--accent)";
}

/**
 * Определяет цветовой статус задачи с учётом многодневных диапазонов.
 * Красный — если задача полностью закончилась. Жёлтый — если пересекается с сегодняшним днём.
 * @param {Date|null} dueAt - Начало задачи.
 * @param {Date|null} dueEndAt - Конец задачи.
 * @returns {{ state: string, label: string }} Статус и метка.
 */
function getTaskDueState(dueAt, dueEndAt) {
  if (!dueAt) return { state: "normal", label: "" };

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const effectiveEnd = dueEndAt || dueAt;

  if (effectiveEnd < now) return { state: "overdue", label: "Просрочено" };

  // Задача активна сегодня, если её диапазон пересекается с текущими сутками
  if (dueAt <= todayEnd && effectiveEnd >= todayStart) {
    return { state: "due-soon", label: "Сегодня" };
  }

  return { state: "normal", label: "" };
}


/**
 * Создаёт фоновые линии часов и получасовых отметок.
 * @returns {HTMLElement[]} Массив DOM-элементов.
 */
function buildHourLines() {
  const lines = [];
  for (let h = 0; h < GRID_HOURS; h++) {
    lines.push(
      el("div", {
        class: "week-hour-line",
        style: { top: `${h * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` },
      }),
    );
    lines.push(
      el("div", {
        class: "week-half-line",
        style: { top: `${h * HOUR_HEIGHT + HOUR_HEIGHT / 2}px` },
      }),
    );
  }
  return lines;
}


/**
 * Группирует пересекающиеся по времени задачи в кластеры.
 * @param {object[]} tasks - Отсортированные задачи.
 * @returns {object[][]} Массив кластеров.
 */
function buildClusters(tasks) {
  if (!tasks.length) return [];
  const clusters = [];
  let cur = [tasks[0]];
  let end = tasks[0]._endTime;

  for (let i = 1; i < tasks.length; i++) {
    if (tasks[i]._startTime < end) {
      cur.push(tasks[i]);
      end = Math.max(end, tasks[i]._endTime);
    } else {
      clusters.push(cur);
      cur = [tasks[i]];
      end = tasks[i]._endTime;
    }
  }
  clusters.push(cur);
  return clusters;
}

/**
 * Распределяет задачи внутри кластера по виртуальным колонкам (жадный алгоритм).
 * @param {object[]} cluster - Кластер задач.
 * @returns {object[]} Задачи с полями `_column` и `_totalColumns`.
 */
function layoutCluster(cluster) {
  const cols = [];
  for (const t of cluster) {
    let placed = false;
    for (let c = 0; c < cols.length; c++) {
      if (cols[c][cols[c].length - 1]._endTime <= t._startTime) {
        cols[c].push(t);
        t._column = c;
        placed = true;
        break;
      }
    }
    if (!placed) {
      t._column = cols.length;
      cols.push([t]);
    }
  }
  for (const t of cluster) t._totalColumns = cols.length;
  return cluster;
}

/**
 * Подготавливает задачи для одного дня. Многодневные задачи обрезаются по границам суток (00:00–24:00).
 * @param {object[]} dayTasks - Задачи, попадающие на текущий день.
 * @param {Date} currentDate - Дата отображаемого дня.
 * @returns {object[]} Задачи с метриками для рендеринга.
 */
function layoutDayTasks(dayTasks, currentDate) {
  if (!dayTasks.length) return [];

  const dayStart = new Date(currentDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(currentDate);
  dayEnd.setHours(23, 59, 59, 999);

  const prepared = dayTasks.map((task) => {
    const dueAt = parseLocalDate(task.due_at);
    const dueEndAt = task.due_end_at ? parseLocalDate(task.due_end_at) : null;
    let s, e;

    if (dueEndAt) {
      // Многодневная задача: обрезаем по границам текущего дня
      s = dueAt < dayStart ? 0 : getMinutesSinceMidnight(dueAt);
      e =
        dueEndAt > dayEnd ? GRID_HOURS * 60 : getMinutesSinceMidnight(dueEndAt);
    } else {
      s = getMinutesSinceMidnight(dueAt);
      e = Math.min(s + MIN_BLOCK_MINUTES, GRID_HOURS * 60);
    }

    // Мин. высота блока для сохранения кликабельности
    if (e - s < MIN_BLOCK_MINUTES) {
      e = Math.min(s + MIN_BLOCK_MINUTES, GRID_HOURS * 60);
      if (e >= GRID_HOURS * 60) s = Math.max(0, e - MIN_BLOCK_MINUTES);
    }

    return {
      ...task,
      _startTime: s,
      _endTime: e,
      _dueAt: dueAt,
      _dueEndAt: dueEndAt,
    };
  });

  prepared.sort((a, b) => a._startTime - b._startTime);
  const result = [];
  for (const c of buildClusters(prepared)) {
    result.push(...layoutCluster(c));
  }
  return result;
}

/**
 * Создаёт DOM-элемент блока задачи.
 * @param {object} task - Задача с метриками layout.
 * @returns {HTMLElement} Блок задачи.
 */
function buildTaskBlock(task) {
  const h = minutesToPx(task._endTime - task._startTime);
  const top = minutesToPx(task._startTime);
  const wp = 100 / task._totalColumns;
  const lp = task._column * wp;
  const due = getTaskDueState(task._dueAt, task._dueEndAt);

  const cls = ["week-task-block"];
  if (task.status === "done") cls.push("is-done");
  if (due.state === "overdue") cls.push("is-overdue");
  else if (due.state === "due-soon") cls.push("is-due-soon");
  if (task.is_pinned) cls.push("is-pinned");

  const block = el("div", {
    class: cls.join(" "),
    dataset: { taskId: task.id },
    style: {
      top: `${top}px`,
      height: `${Math.max(h, MIN_BLOCK_HEIGHT)}px`,
      width: `calc(${wp}% - ${BLOCK_SIDE_GAP * 2}px)`,
      left: `calc(${lp}% + ${BLOCK_SIDE_GAP}px)`,
      borderLeftColor: getStateColor(due.state),
    },
  });

  if (h >= 20)
    block.appendChild(
      el("div", { class: "week-block-title", text: task.title }),
    );
  if (h >= 40)
    block.appendChild(
      el("div", {
        class: "week-block-time",
        text: formatTimeRange(task._dueAt, task._dueEndAt),
      }),
    );

  return block;
}


/**
 * Отрисовывает и обновляет линию текущего времени.
 * Пересчитывает колонку при каждом тике, чтобы линия корректно переходила в новый день после полуночи.
 * @param {HTMLElement} grid - Контейнер сетки.
 * @param {Date} weekStart - Начало недели.
 */
function renderTimeIndicator(grid, weekStart) {
  if (timeIndicatorInterval) clearInterval(timeIndicatorInterval);
  grid.querySelectorAll(".week-time-indicator").forEach((e) => e.remove());

  let ind = null;

  const updateIndicator = () => {
    const now = new Date();
    const currentTk = dateKey(now);
    let currentTi = -1;

    for (let i = 0; i < 7; i++) {
      if (dateKey(addDays(weekStart, i)) === currentTk) {
        currentTi = i;
        break;
      }
    }

    const m = getMinutesSinceMidnight(now);
    if (currentTi === -1 || m < 0 || m >= GRID_HOURS * 60) {
      if (ind) ind.style.display = "none";
      return;
    }

    if (!ind) {
      ind = el("div", {
        class: "week-time-indicator",
        style: { width: `${(1 / 7) * 100}%` },
      });
      ind.appendChild(el("div", { class: "week-time-dot" }));
      ind.appendChild(el("div", { class: "week-time-line" }));
      const dc = grid.querySelector(".week-days-container");
      if (dc) dc.appendChild(ind);
    }

    ind.style.display = "";
    ind.style.top = `${minutesToPx(m)}px`;
    ind.style.left = `${(currentTi / 7) * 100}%`;
  };

  updateIndicator();
  timeIndicatorInterval = setInterval(updateIndicator, 60000);
}

/**
 * Автоматически прокручивает сетку к текущему времени.
 * Скролл применяется к .week-grid-body, так как именно он имеет overflow-y: auto.
 * @param {HTMLElement} grid - Контейнер сетки.
 * @param {Date} weekStart - Начало недели.
 */
function scrollToCurrentTime(grid, weekStart) {
  requestAnimationFrame(() => {
    const body = grid.querySelector(".week-grid-body");
    if (!body) return;

    const now = new Date();
    const tk = dateKey(now);
    let inWeek = false;
    for (let i = 0; i < 7; i++) {
      if (dateKey(addDays(weekStart, i)) === tk) {
        inWeek = true;
        break;
      }
    }

    body.scrollTop = Math.max(
      0,
      inWeek
        ? minutesToPx(getMinutesSinceMidnight(now)) - body.clientHeight / 3
        : 8 * HOUR_HEIGHT,
    );
  });
}


/** Показывает тултип с деталями задачи рядом с блоком. */
function showTooltip(tooltip, block, task, grid) {
  tooltip.innerHTML = "";
  tooltip.appendChild(
    el("div", { class: "week-tooltip-title", text: task.title }),
  );
  tooltip.appendChild(
    el("div", {
      class: "week-tooltip-time",
      text: formatTimeRange(task._dueAt, task._dueEndAt),
    }),
  );
  if (task.type_name)
    tooltip.appendChild(
      el("div", { class: "week-tooltip-type", text: task.type_name }),
    );

  tooltip.style.display = "block";
  const br = block.getBoundingClientRect();
  const gr = grid.getBoundingClientRect();
  const tr = tooltip.getBoundingClientRect();

  let l = br.right - gr.left + 8;
  let t = br.top - gr.top;

  if (l + tr.width > grid.clientWidth) l = br.left - gr.left - tr.width - 8;
  if (t + tr.height > grid.clientHeight) t = grid.clientHeight - tr.height - 8;
  if (t < 0) t = 8;

  tooltip.style.left = `${l}px`;
  tooltip.style.top = `${t}px`;
}

/** Скрывает тултип. */
function hideTooltip(t) {
  t.style.display = "none";
}


/** Находит колонку дня по координате X. */
function getColumnAtX(x, dc) {
  for (const c of dc.querySelectorAll(".week-day-column")) {
    const r = c.getBoundingClientRect();
    if (x >= r.left && x <= r.right)
      return { column: c, index: Number(c.dataset.dayIndex) };
  }
  return null;
}

/** Ищет задачу в state по ID. */
function findTaskById(id) {
  return state.tasks.find((t) => t.id === id);
}

/** Создаёт плавающий бейдж с временем для Drag-and-Drop. */
function createDragBadge() {
  const b = el("div", { class: "week-drag-time-badge" });
  b.style.display = "none";
  document.body.appendChild(b);
  return b;
}

/**
 * Завершает перетаскивание: вычисляет новые даты и сохраняет их.
 * Сохраняет scrollTop у .week-grid-body для предотвращения скачков интерфейса.
 * @param {MouseEvent|Touch} e - Событие или объект с координатами.
 * @param {Function} onUpdate - Callback для обновления UI.
 * @param {HTMLElement} grid - Контейнер сетки.
 * @returns {Promise<void>}
 */
async function finishDrag(e, onUpdate, grid) {
  if (!dragState) return;

  const { task, startDayIndex, weekStart, dragBadge } = dragState;
  const dy = e.clientY - dragState.startY;
  const dc = dragState.block.closest(".week-days-container");
  if (!dc) return;

  const col = getColumnAtX(e.clientX, dc);
  const ni = col ? col.index : startDayIndex;

  let nd = addMinutes(task._dueAt, pxToMinutes(dy));
  nd = snapToGrid(nd, SNAP_MINUTES);

  const ndate = addDays(weekStart, ni);
  nd.setFullYear(ndate.getFullYear());
  nd.setMonth(ndate.getMonth());
  nd.setDate(ndate.getDate());

  const sm = getMinutesSinceMidnight(nd);
  if (sm < 0) nd.setHours(0, 0, 0, 0);
  else if (sm >= GRID_HOURS * 60) nd.setHours(23, 45, 0, 0);

  let ne = null;
  if (task._dueEndAt) {
    ne = new Date(
      nd.getTime() + (task._dueEndAt.getTime() - task._dueAt.getTime()),
    );
  }

  if (dragBadge) dragBadge.remove();

  const gridBody = grid ? grid.querySelector(".week-grid-body") : null;
  const scrollTop = gridBody ? gridBody.scrollTop : 0;

  try {
    await api.updateTask(task.id, {
      dueAt: toDatetimeLocalValue(nd),
      dueEndAt: ne ? toDatetimeLocalValue(ne) : null,
    });
    if (onUpdate) onUpdate(scrollTop);
  } catch (err) {
    console.error("Drag error:", err);
  }
}

/** Навешивает обработчики клика и Drag-and-Drop на блоки задач. */
function attachDragAndClick(allBlocks, weekStart, onUpdate, grid) {
  allBlocks.forEach(({ block, task, dayIndex }) => {
    block.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const sx = e.clientX;
      const sy = e.clientY;

      dragState = {
        block,
        task,
        startX: sx,
        startY: sy,
        startDayIndex: dayIndex,
        weekStart,
        moved: false,
        dragBadge: createDragBadge(),
      };

      document.body.style.cursor = "grabbing";
      block.style.zIndex = "200";
      block.style.transition = "none";

      const onMove = (ev) => {
        if (!dragState) return;
        const dx = ev.clientX - sx;
        const dy = ev.clientY - sy;

        if (
          !dragState.moved &&
          (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)
        ) {
          dragState.moved = true;
          block.classList.add("is-dragging");
        }

        if (dragState.moved) {
          block.style.transform = `translate(${dx}px, ${dy}px)`;
          const tt = block
            .closest(".week-grid")
            ?.querySelector(".week-tooltip");
          if (tt) hideTooltip(tt);

          let pd = addMinutes(task._dueAt, pxToMinutes(dy));
          pd = snapToGrid(pd, SNAP_MINUTES);
          let pe = task._dueEndAt
            ? new Date(
                pd.getTime() +
                  (task._dueEndAt.getTime() - task._dueAt.getTime()),
              )
            : null;

          dragState.dragBadge.textContent = formatTimeRange(pd, pe);
          dragState.dragBadge.style.display = "block";
          dragState.dragBadge.style.left = `${ev.clientX + 12}px`;
          dragState.dragBadge.style.top = `${ev.clientY - 30}px`;
        }
      };

      const cleanup = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        window.removeEventListener("blur", cleanup);
      };

      const onUp = async (ev) => {
        cleanup();
        if (!dragState) return;

        document.body.style.cursor = "";
        block.style.transform = "";
        block.style.zIndex = "";
        block.style.transition = "";
        block.classList.remove("is-dragging");

        if (!dragState.moved) {
          openTaskPanel((findTaskById(task.id) || task).id, "view");
        } else {
          await finishDrag(ev, onUpdate, grid);
        }
        dragState = null;
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      window.addEventListener("blur", cleanup);
    });

    let lpt = null;
    let isDrag = false;
    let tsx = 0;
    let tsy = 0;

    block.addEventListener(
      "touchstart",
      (e) => {
        tsx = e.touches[0].clientX;
        tsy = e.touches[0].clientY;
        isDrag = false;

        lpt = setTimeout(() => {
          isDrag = true;
          block.classList.add("is-dragging");
          block.style.zIndex = "200";
          if (navigator.vibrate) navigator.vibrate(30);
          dragState = {
            block,
            task,
            startX: tsx,
            startY: tsy,
            startDayIndex: dayIndex,
            weekStart,
            moved: true,
            dragBadge: createDragBadge(),
          };
        }, LONG_PRESS_MS);
      },
      { passive: true },
    );

    block.addEventListener(
      "touchmove",
      (e) => {
        if (!isDrag) {
          if (
            Math.abs(e.touches[0].clientX - tsx) > 10 ||
            Math.abs(e.touches[0].clientY - tsy) > 10
          )
            clearTimeout(lpt);
          return;
        }
        e.preventDefault();
        if (!dragState) return;

        const dx = e.touches[0].clientX - dragState.startX;
        const dy = e.touches[0].clientY - dragState.startY;
        block.style.transform = `translate(${dx}px, ${dy}px)`;

        let pd = addMinutes(task._dueAt, pxToMinutes(dy));
        pd = snapToGrid(pd, SNAP_MINUTES);
        let pe = task._dueEndAt
          ? new Date(
              pd.getTime() + (task._dueEndAt.getTime() - task._dueAt.getTime()),
            )
          : null;

        dragState.dragBadge.textContent = formatTimeRange(pd, pe);
        dragState.dragBadge.style.display = "block";
        dragState.dragBadge.style.left = `${e.touches[0].clientX + 12}px`;
        dragState.dragBadge.style.top = `${e.touches[0].clientY - 40}px`;
      },
      { passive: false },
    );

    block.addEventListener(
      "touchend",
      async (e) => {
        clearTimeout(lpt);
        if (!isDrag) {
          openTaskPanel((findTaskById(task.id) || task).id, "view");
          return;
        }
        isDrag = false;
        block.style.transform = "";
        block.style.zIndex = "";
        block.classList.remove("is-dragging");

        if (dragState) {
          const t = e.changedTouches[0];
          await finishDrag(
            { clientX: t.clientX, clientY: t.clientY },
            onUpdate,
            grid,
          );
          dragState = null;
        }
      },
      { passive: true },
    );
  });
}

/** Навешивает обработчики клика по пустым ячейкам для быстрого создания задач. */
function attachEmptyCellClick(grid, weekStart) {
  grid.querySelectorAll(".week-day-column").forEach((column) => {
    column.addEventListener("click", (e) => {
      if (
        e.target.closest(".week-task-block") ||
        e.target.closest(".week-plus-btn") ||
        dragState?.moved
      )
        return;
      removeActivePlus();

      const rect = column.getBoundingClientRect();
      const bodyEl = grid.querySelector(".week-grid-body");
      const offsetY = e.clientY - rect.top + (bodyEl ? bodyEl.scrollTop : 0);
      const sm = Math.round(pxToMinutes(offsetY) / SNAP_MINUTES) * SNAP_MINUTES;

      const dd = addDays(weekStart, Number(column.dataset.dayIndex));
      const da = new Date(dd);
      da.setHours(0, 0, 0, 0);
      const fd = addMinutes(
        da,
        Math.max(0, Math.min(sm, GRID_HOURS * 60 - SNAP_MINUTES)),
      );

      const tp = minutesToPx(getMinutesSinceMidnight(fd));
      const ds = toDatetimeLocalValue(fd);

      const btn = el("button", {
        class: "week-plus-btn",
        type: "button",
        "aria-label": "Создать задачу",
        style: { top: `${tp - 10}px`, left: "calc(50% - 10px)" },
      });
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;

      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        removeActivePlus();
        openTaskPanel(null, "edit", { dueAt: ds });
      });

      column.appendChild(btn);
      activePlusEl = btn;
    });
  });

  if (!isGlobalDocListenersAttached) {
    isGlobalDocListenersAttached = true;
    document.addEventListener("click", (e) => {
      if (
        activePlusEl &&
        !e.target.closest(".week-plus-btn") &&
        !e.target.closest(".week-day-column")
      )
        removeActivePlus();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && activePlusEl) removeActivePlus();
    });
  }
}


/**
 * Отрисовывает полную сетку недели.
 * @param {Date} weekStart - Начало недели.
 * @param {object[]} allTasks - Все задачи.
 * @param {Function} onUpdate - Callback после Drag-and-Drop.
 * @param {number|null} [restoreScrollTop=null] - Позиция скролла для восстановления.
 * @returns {HTMLElement} Контейнер сетки.
 */
export function renderWeekGrid(
  weekStart,
  allTasks,
  onUpdate,
  restoreScrollTop = null,
) {
  removeActivePlus();
  const grid = el("div", { class: "week-grid" });

  const header = el("div", { class: "week-grid-header" });
  header.appendChild(
    el("div", {
      class: "week-header-corner",
      style: { width: `${TIME_SCALE_WIDTH}px` },
    }),
  );

  const tk = dateKey(new Date());
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    const it = dateKey(d) === tk;
    const iw = i === 5 || i === 6;

    header.appendChild(
      el(
        "div",
        {
          class: `week-header-day${it ? " is-today" : ""}${iw ? " is-weekend" : ""}`,
        },
        [
          el("div", {
            class: `week-header-day-name${iw ? " is-weekend" : ""}`,
            text: WEEKDAYS[i],
          }),
          el("div", {
            class: `week-header-day-num${it ? " is-today" : ""}${iw ? " is-weekend" : ""}`,
            text: String(d.getDate()),
          }),
        ],
      ),
    );
  }
  grid.appendChild(header);

  const body = el("div", { class: "week-grid-body" });
  const ts = el("div", {
    class: "week-time-scale",
    style: { width: `${TIME_SCALE_WIDTH}px` },
  });
  for (let h = 1; h <= GRID_HOURS; h++) {
    ts.appendChild(
      el("div", {
        class: "week-time-label",
        text: h === GRID_HOURS ? "0" : String(h),
        style: { top: `${h * HOUR_HEIGHT}px` },
      }),
    );
  }
  body.appendChild(ts);

  const dc = el("div", { class: "week-days-container" });
  const allBlocks = [];

  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    const dk = dateKey(d);
    const iw = i === 5 || i === 6;

    const col = el("div", {
      class: `week-day-column${iw ? " is-weekend" : ""}`,
      dataset: { dayIndex: i, dateKey: dk },
      style: { height: `${GRID_HEIGHT}px` },
    });
    buildHourLines().forEach((l) => col.appendChild(l));

    // Фильтрация с учётом многодневных задач: задача должна пересекаться с текущим днём
    const dayStart = new Date(d);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(d);
    dayEnd.setHours(23, 59, 59, 999);

    const dt = allTasks.filter((t) => {
      if (!t.due_at || t.deleted_at) return false;
      const dueAt = parseLocalDate(t.due_at);
      const dueEndAt = t.due_end_at ? parseLocalDate(t.due_end_at) : null;
      const taskEnd =
        dueEndAt || new Date(dueAt.getTime() + MIN_BLOCK_MINUTES * 60 * 1000);
      return !(dueAt > dayEnd || taskEnd < dayStart);
    });

    layoutDayTasks(dt, d).forEach((task) => {
      const b = buildTaskBlock(task);
      col.appendChild(b);
      allBlocks.push({ block: b, task, dayIndex: i });
    });
    dc.appendChild(col);
  }

  body.appendChild(dc);
  grid.appendChild(body);

  const tooltip = el("div", { class: "week-tooltip" });
  grid.appendChild(tooltip);

  attachDragAndClick(allBlocks, weekStart, onUpdate, grid);
  attachEmptyCellClick(grid, weekStart);

  allBlocks.forEach(({ block, task }) => {
    block.addEventListener("mouseenter", () =>
      showTooltip(tooltip, block, task, grid),
    );
    block.addEventListener("mouseleave", () => hideTooltip(tooltip));
  });

  renderTimeIndicator(grid, weekStart);

  // Восстановление скролла или автопрокрутка к текущему времени
  if (restoreScrollTop !== null && restoreScrollTop > 0) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const scrollBody = grid.querySelector(".week-grid-body");
        if (scrollBody) scrollBody.scrollTop = restoreScrollTop;
      });
    });
  } else {
    scrollToCurrentTime(grid, weekStart);
  }

  return grid;
}