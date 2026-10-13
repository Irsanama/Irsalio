/**
 * @file Переиспользуемые UI-компоненты и функции обеспечения (ensure).
 * @description Содержит фабрики для создания бейджей (статус, приоритет, тип, срок),
 *              прогресс-баров, а также функции гарантированного создания динамических
 *              DOM-элементов (фильтры, бейджи режима хранения).
 */

import { el, $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { getDueState } from "../core/dates.js";
import {
  state,
  PRIORITY_LABELS,
  STATUS_LABELS,
  STATE_FILTER_OPTIONS,
  dueStateToBadgeClass,
} from "../state/state.js";


const ONE_HOUR_MS = 3_600_000;
const PROGRESS_PERCENT_LOW = 33;
const PROGRESS_PERCENT_MID = 66;
const DEFAULT_TYPE_COLOR = "#6F6A63";


/**
 * Инжектирует глобальные CSS-правила, которые невозможно вынести в статические файлы
 * (например, переопределение ширины модалок из JS).
 */
export function ensureRuntimeStyles() {
  if ($("#irsalio-runtime-fixes")) return;

  const style = el("style", { id: "irsalio-runtime-fixes" });
  style.textContent = `.modal.modal-wide { max-width: 560px; }`;
  document.head.appendChild(style);
}

/**
 * Гарантирует наличие выпадающего списка фильтра по статусу в топбаре.
 * Если элемента нет — создаёт его и вставляет перед фильтром сортировки.
 */
export function ensureStatusFilter() {
  const tools = $("#records-tools");
  if (!tools) return;

  let select = $("#status-filter-select");
  if (!select) {
    select = el("select", {
      class: "input-sm",
      id: "status-filter-select",
      "aria-label": "Фильтр по состоянию",
    });

    STATE_FILTER_OPTIONS.forEach((opt) =>
      select.appendChild(el("option", { value: opt.value, text: opt.label })),
    );

    const sortSelect = $("#sort-select");
    if (sortSelect) tools.insertBefore(select, sortSelect);
    else tools.prepend(select);
  }

  select.value = state.statusFilter || "";
  // В корзине фильтр по статусу не имеет смысла, скрываем его
  select.style.display = state.recordsView === "trash" ? "none" : "";
}

/**
 * Гарантирует наличие бейджа режима хранения (Локально/Сервер) в шапке сайдбара.
 * Корректно переставляет элементы, если DOM был изменён извне.
 */
export function ensureStorageBadgeInSidebar() {
  const badge = $("#storage-mode-badge");
  const header = $(".sidebar-header");
  if (!badge || !header) return;

  let right = $(".sidebar-header-right");

  if (!right) {
    right = el("div", { class: "sidebar-header-right" });
    const closeBtn = $("#sidebar-close");

    if (closeBtn && closeBtn.parentElement === header) {
      header.replaceChild(right, closeBtn);
      right.appendChild(badge);
      right.appendChild(closeBtn);
    } else {
      header.appendChild(right);
      right.appendChild(badge);
    }
  } else if (badge.parentElement !== right) {
    right.insertBefore(badge, right.firstChild);
  }
}


/**
 * Создаёт бейдж срока выполнения задачи с иконкой и цветовой индикацией.
 * Добавляет класс `is-critical`, если до дедлайна менее часа (для просроченных).
 *
 * @param {object} task - Объект задачи.
 * @returns {HTMLElement} Бейдж срока.
 */
export function buildDueBadge(task) {
  const due = getDueState(task);
  const badgeClass = dueStateToBadgeClass(due.state);

  const dueTimestamp = task.due_at ? new Date(task.due_at).getTime() : 0;
  const isCritical =
    task.due_at &&
    task.status !== "done" &&
    Math.abs(dueTimestamp - Date.now()) < ONE_HOUR_MS;

  const classes = ["badge"];
  if (badgeClass) classes.push(badgeClass);
  if (isCritical && due.state === "overdue") classes.push("is-critical");

  const badge = el("span", { class: classes.join(" ") });

  if (due.state === "overdue") badge.appendChild(icon("alert", 12));
  else if (due.state === "due-soon") badge.appendChild(icon("clock", 12));

  badge.appendChild(document.createTextNode(due.label));
  return badge;
}

/**
 * Создаёт бейдж приоритета.
 *
 * @param {number} priority - Числовой приоритет (1–4).
 * @returns {HTMLElement} Бейдж приоритета.
 */
export function buildPriorityBadge(priority) {
  return el("span", {
    class: `badge badge-priority-${priority}`,
    text: PRIORITY_LABELS[priority] || "Средний",
  });
}

/**
 * Создаёт бейдж типа задачи с динамическим цветом через CSS-переменную.
 *
 * @param {object} task - Объект задачи.
 * @returns {HTMLElement} Бейдж типа.
 */
export function buildTypeBadge(task) {
  if (!task.type_name) {
    return el("span", { class: "badge", text: "Без типа" });
  }

  return el("span", {
    class: "badge badge-type",
    style: { "--type-color": task.type_color || DEFAULT_TYPE_COLOR },
    text: task.type_name,
  });
}

/**
 * Создаёт превью описания задачи (обычный текст, без Markdown).
 *
 * @param {object} task - Объект задачи.
 * @returns {HTMLElement|null} Элемент превью или null, если описания нет.
 */
export function buildDescriptionPreview(task) {
  const text = String(task.description || "").trim();
  return text ? el("div", { class: "task-card-desc", text }) : null;
}

/**
 * Создаёт прогресс-бар выполнения подзадач.
 * Цвет заполнения динамически меняется в зависимости от процента готовности
 * и состояния срока (просрочено/скоро истекает).
 *
 * @param {object} task - Объект задачи.
 * @returns {HTMLElement|null} Прогресс-бар или null, если подзадач нет.
 */
export function buildProgressBar(task) {
  if (!task.subtasks_total) return null;

  const percent = Math.round(
    (task.subtasks_completed / task.subtasks_total) * 100,
  );
  const due = getDueState(task);

  let color = "var(--success)";
  if (percent < 100) {
    if (due.state === "overdue") color = "var(--danger)";
    else if (due.state === "due-soon") color = "var(--warning)";
    else if (percent < PROGRESS_PERCENT_LOW) color = "var(--danger)";
    else if (percent < PROGRESS_PERCENT_MID) color = "var(--warning)";
    else color = "var(--progress-mid)";
  }

  return el("div", { class: "task-progress" }, [
    el("div", { class: "progress-track" }, [
      el("div", {
        class: "progress-fill",
        style: { width: `${percent}%`, background: color },
      }),
    ]),
    el("div", {
      class: "progress-label",
      text: `${task.subtasks_completed}/${task.subtasks_total}`,
    }),
  ]);
}

/**
 * Создаёт кликабельную кнопку статуса задачи.
 *
 * @param {object} task - Объект задачи.
 * @returns {HTMLElement} Кнопка статуса.
 */
export function buildStatusButton(task) {
  return el(
    "button",
    {
      class: `badge task-status status-${task.status}`,
      dataset: { action: "cycle-status", id: task.id },
      title: "Сменить статус",
    },
    [STATUS_LABELS[task.status] || "К выполнению"],
  );
}

/**
 * Создаёт кликабельную кнопку приоритета задачи.
 *
 * @param {object} task - Объект задачи.
 * @returns {HTMLElement} Кнопка приоритета.
 */
export function buildPriorityButton(task) {
  return el(
    "button",
    {
      class: `badge badge-priority-${task.priority} task-priority-btn`,
      dataset: { action: "cycle-priority", id: task.id },
      title: "Сменить приоритет",
    },
    [PRIORITY_LABELS[task.priority] || "Средний"],
  );
}