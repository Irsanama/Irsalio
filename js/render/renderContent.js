/**
 * @file Главный модуль рендеринга контента рабочей области.
 * @description Переключает отрисовку между вкладками: Записи, Дашборд, Календарь, Внимание.
 *              Содержит функции построения списков задач, пустых состояний (empty states),
 *              дашборда с KPI-метриками и панели внимания.
 */

import { $, clear, el } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { toast, confirmDialog } from "../core/ui.js";
import { getDueState, formatDueDate } from "../core/dates.js";
import {
  state,
  EMPTY_TEXTS,
  getFilteredTasks,
  isTaskOverdue,
  isTaskDueSoon,
  dueStateToCardClass,
} from "../state/state.js";
import {
  buildDueBadge,
  buildTypeBadge,
  buildDescriptionPreview,
  buildProgressBar,
  buildStatusButton,
  buildPriorityButton,
} from "./components.js";
import { api } from "../storage/api.js";
import { refreshTasks } from "../features/auth.js";
import { renderTypeFilter, renderTopbar } from "./renderLayout.js";
import { renderSidebarBody } from "./renderSidebar.js";
import { renderDates } from "./renderCalendar.js";
import { openTaskPanel } from "../features/taskPanel.js";


const MAX_ATTENTION_TASKS = 5;
const MAX_RECENT_TASKS = 5;
const MAX_TYPE_BARS = 6;


/**
 * Полностью перерисовывает контент рабочей области в зависимости от активной вкладки.
 * Очищает контейнер перед вставкой новых элементов.
 *
 * @param {number|null} [restoreScrollTop=null] - Позиция скролла для восстановления (актуально для календаря).
 */
export function renderContent(restoreScrollTop = null) {
  const content = $("#content");
  if (!content) return;

  clear(content);

  switch (state.sidebarTab) {
    case "records":
      renderRecords(content);
      break;
    case "dashboard":
      renderDashboard(content);
      break;
    case "dates":
      renderDates(content, restoreScrollTop);
      break;
    case "attention":
      renderAttention(content);
      break;
    default:
      renderRecords(content);
  }
}


/**
 * Отрисовывает список записей с учётом фильтров и представлений.
 * Если открыта корзина и в ней есть задачи, добавляет заголовок с кнопкой очистки.
 *
 * @param {HTMLElement} container - Контейнер для вставки.
 */
function renderRecords(container) {
  const visibleTasks = getFilteredTasks();

  if (state.recordsView === "trash" && visibleTasks.length > 0) {
    container.appendChild(
      el("div", { class: "trash-header" }, [
        el("span", { text: `В корзине: ${visibleTasks.length}` }),
        el(
          "button",
          {
            class: "btn btn-danger btn-sm",
            text: "Очистить корзину",
            onclick: clearAllTrash,
          },
          [icon("trash", 14)],
        ),
      ]),
    );
  }

  if (!visibleTasks.length) {
    container.appendChild(
      renderEmptyState(state.statusFilter ? "filter" : undefined),
    );
    return;
  }

  container.appendChild(renderTable(visibleTasks));
}

/**
 * Создаёт DOM-элемент пустого состояния (empty state) с эмодзи, текстом и кнопками действий.
 *
 * @param {string} [forceKey] - Принудительный ключ текста (например, 'filter').
 * @returns {HTMLElement} Элемент пустого состояния.
 */
function renderEmptyState(forceKey) {
  const texts = forceKey
    ? EMPTY_TEXTS[forceKey]
    : state.search
      ? EMPTY_TEXTS.search
      : EMPTY_TEXTS[state.recordsView] || EMPTY_TEXTS.all;

  const actions = [];

  if (forceKey === "filter") {
    actions.push(
      el(
        "button",
        {
          class: "btn btn-secondary",
          onclick: () => {
            state.statusFilter = "";
            state.typeId = "";
            renderTopbar();
            renderSidebarBody();
            renderTypeFilter();
            renderContent();
          },
        },
        [icon("rotate-ccw", 14), el("span", { text: "Сбросить фильтры" })],
      ),
    );
  }

  actions.push(
    el(
      "button",
      { class: "btn btn-primary", onclick: () => openTaskPanel(null, "edit") },
      [icon("plus", 14), el("span", { text: "Новая запись" })],
    ),
  );

  return el("div", { class: "empty" }, [
    el("div", { class: "empty-emoji", text: texts.emoji }),
    el("h1", { class: "empty-title", text: texts.title }),
    el("p", { class: "empty-text", text: texts.text }),
    el(
      "div",
      {
        style: {
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
          justifyContent: "center",
        },
      },
      actions,
    ),
  ]);
}

/**
 * Оборачивает массив задач в контейнер списка.
 *
 * @param {Array<object>} tasks - Массив задач.
 * @returns {HTMLElement} Контейнер списка.
 */
function renderTable(tasks = []) {
  const list = el("div", { class: "records-list" });
  tasks.forEach((task) => list.appendChild(renderRecordRow(task)));
  return list;
}

/**
 * Создаёт DOM-элемент карточки одной задачи (строки списка).
 * Обрабатывает клики для открытия панели, чекбоксы для смены статуса и кнопки действий.
 *
 * @param {object} task - Объект задачи.
 * @returns {HTMLElement} Карточка задачи.
 */
function renderRecordRow(task) {
  const due = getDueState(task);
  const isDone = task.status === "done";
  const isTrash = Boolean(task.deleted_at);
  const dueClass = isTrash ? "" : dueStateToCardClass(due.state);

  const rowClass = [
    "record-row",
    "task-card",
    isDone ? "is-done" : "",
    dueClass,
    task.is_pinned ? "is-pinned" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const row = el("div", {
    class: rowClass,
    dataset: { id: task.id, status: task.status },
    tabindex: 0,
    role: "button",
    "aria-label": `Открыть запись: ${task.title}`,
  });

  // Чекбокс выполнения
  const checkbox = el("input", {
    type: "checkbox",
    class: "checkbox",
    checked: isDone,
    "aria-label": isDone ? "Вернуть в работу" : "Отметить выполненной",
    onclick: async (e) => {
      e.stopPropagation();
      await api.updateTask(task.id, { status: isDone ? "todo" : "done" });
      await refreshTasks();
    },
  });
  if (isTrash) checkbox.disabled = true;

  // Основной контент карточки
  const content = el("div", { class: "task-card-content" });
  const rowTop = el("div", { class: "task-card-row-top" });

  const titleWrap = el("div", { class: "task-card-title-wrap" });
  if (task.is_pinned) {
    titleWrap.appendChild(
      el("span", { class: "task-card-pin" }, [icon("star-filled", 14)]),
    );
  }
  titleWrap.appendChild(
    el("span", { class: "task-card-title", text: task.title }),
  );
  rowTop.appendChild(titleWrap);

  // Кнопки действий (зависят от того, в корзине задача или нет)
  const actions = el("div", { class: "task-card-actions" });
  if (isTrash) {
    actions.append(
      el(
        "button",
        {
          class: "icon-btn",
          "aria-label": "Вернуть",
          title: "Вернуть",
          dataset: { action: "restore", id: task.id },
        },
        [icon("rotate-ccw", 14)],
      ),
      el(
        "button",
        {
          class: "icon-btn",
          "aria-label": "Удалить навсегда",
          title: "Удалить навсегда",
          dataset: { action: "permanent-delete", id: task.id },
        },
        [icon("x", 14)],
      ),
    );
  } else {
    actions.append(
      el(
        "button",
        {
          class: "icon-btn",
          "aria-label": task.is_pinned ? "Убрать из избранного" : "В избранное",
          title: task.is_pinned ? "Убрать из избранного" : "В избранное",
          dataset: { action: "pin", id: task.id },
        },
        [icon(task.is_pinned ? "star-filled" : "star", 14)],
      ),
      el(
        "button",
        {
          class: "icon-btn",
          "aria-label": "В корзину",
          title: "В корзину",
          dataset: { action: "delete", id: task.id },
        },
        [icon("trash", 14)],
      ),
    );
  }
  rowTop.appendChild(actions);
  content.appendChild(rowTop);

  const desc = buildDescriptionPreview(task);
  if (desc) content.appendChild(desc);

  // Мета-информация (бейджи)
  const meta = el("div", { class: "task-card-meta" });
  if (task.due_at) meta.appendChild(buildDueBadge(task));
  if (task.type_name) meta.appendChild(buildTypeBadge(task));
  meta.appendChild(buildStatusButton(task));
  meta.appendChild(buildPriorityButton(task));
  content.appendChild(meta);

  const progress = buildProgressBar(task);
  if (progress) content.appendChild(progress);

  row.append(checkbox, content);

  // Обработчики открытия панели
  row.addEventListener("click", (e) => {
    if (!e.target.closest("[data-action]") && !e.target.closest(".checkbox")) {
      openTaskPanel(task.id, "view");
    }
  });

  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!e.target.closest("[data-action]")) openTaskPanel(task.id, "view");
    }
  });

  return row;
}


/**
 * Отрисовывает дашборд с KPI-метриками, распределением по типам и недавними задачами.
 *
 * @param {HTMLElement} container - Контейнер для вставки.
 */
function renderDashboard(container) {
  const dashboard = el("div", { class: "dashboard" });

  // --- KPI-карточки ---
  const kpiGrid = el("div", { class: "kpi-grid" });
  const activeTasks = state.tasks.filter(
    (t) => t.status !== "done" && !t.deleted_at,
  );
  const doneTasks = state.tasks.filter(
    (t) => t.status === "done" && !t.deleted_at,
  );
  const overdueCount = state.tasks.filter(isTaskOverdue).length;
  const todayCount = state.tasks.filter(isTaskDueSoon).length;

  kpiGrid.appendChild(
    buildKpiCard("Активных", activeTasks.length, "не выполнено"),
  );
  kpiGrid.appendChild(
    buildKpiCard("Выполнено", doneTasks.length, "всего", "is-success"),
  );
  kpiGrid.appendChild(
    buildKpiCard(
      "Просрочено",
      overdueCount,
      overdueCount > 0 ? "требуют внимания" : "всё в порядке",
      overdueCount > 0 ? "is-danger" : "",
    ),
  );
  kpiGrid.appendChild(
    buildKpiCard(
      "Сегодня",
      todayCount,
      "запланировано",
      todayCount > 0 ? "is-warning" : "",
    ),
  );
  dashboard.appendChild(kpiGrid);

  // --- Панели с графиками и списками ---
  const dashGrid = el("div", { class: "dash-grid" });

  // Распределение по типам
  const typePanel = el("div", { class: "panel" });
  typePanel.appendChild(el("div", { class: "panel-title", text: "По типам" }));

  const typeCounts = {};
  activeTasks.forEach((t) => {
    const tn = t.type_name || "Без типа";
    typeCounts[tn] = (typeCounts[tn] || 0) + 1;
  });

  const maxCount = Math.max(...Object.values(typeCounts), 1);
  const sortedTypes = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TYPE_BARS);

  if (sortedTypes.length > 0) {
    sortedTypes.forEach(([tn, count]) => {
      const type = state.types.find((t) => t.name === tn);
      const color = type?.color || "var(--accent)";

      typePanel.appendChild(
        el("div", { class: "bar-row" }, [
          el("span", { text: tn }),
          el("div", { class: "bar-track" }, [
            el("div", {
              class: "bar-fill",
              style: {
                width: `${(count / maxCount) * 100}%`,
                "--bar-color": color,
              },
            }),
          ]),
          el("span", { class: "bar-value", text: String(count) }),
        ]),
      );
    });
  } else {
    typePanel.appendChild(
      el("div", {
        style: {
          color: "var(--text-faint)",
          fontSize: "0.82rem",
          padding: "var(--sp-2) 0",
        },
        text: "Нет активных записей",
      }),
    );
  }
  dashGrid.appendChild(typePanel);

  // Недавно обновлённые
  const recentPanel = el("div", { class: "panel" });
  recentPanel.appendChild(
    el("div", { class: "panel-title", text: "Недавно обновлённые" }),
  );

  const recentList = el("div", { class: "recent-list" });
  const recentTasks = state.tasks
    .filter((t) => !t.deleted_at)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, MAX_RECENT_TASKS);

  if (recentTasks.length > 0) {
    recentTasks.forEach((task) => {
      const updated = task.updated_at
        ? new Date(String(task.updated_at).replace(" ", "T"))
        : new Date();

      recentList.appendChild(
        el(
          "button",
          {
            class: "recent-item",
            onclick: () => openTaskPanel(task.id, "view"),
          },
          [
            el("span", { class: "recent-title", text: task.title }),
            el("span", {
              class: "recent-meta",
              text: formatDueDate(
                Number.isNaN(updated.getTime()) ? new Date() : updated,
              ),
            }),
          ],
        ),
      );
    });
  } else {
    recentList.appendChild(
      el("div", {
        style: {
          color: "var(--text-faint)",
          fontSize: "0.82rem",
          padding: "var(--sp-2) 0",
        },
        text: "Нет записей",
      }),
    );
  }
  recentPanel.appendChild(recentList);
  dashGrid.appendChild(recentPanel);

  dashboard.appendChild(dashGrid);
  container.appendChild(dashboard);
}

/**
 * Создаёт KPI-карточку для дашборда.
 *
 * @param {string} label - Заголовок метрики.
 * @param {number} value - Числовое значение.
 * @param {string} note - Дополнительная подпись.
 * @param {string} [modifier=''] - CSS-модификатор (например, 'is-success').
 * @returns {HTMLElement} KPI-карточка.
 */
function buildKpiCard(label, value, note, modifier = "") {
  return el("div", { class: `kpi-card ${modifier}`.trim() }, [
    el("div", { class: "kpi-label", text: label }),
    el("div", { class: "kpi-value", text: String(value) }),
    el("div", { class: "kpi-note", text: note }),
  ]);
}


/**
 * Отрисовывает панель внимания со списками просроченных и скоро истекающих задач.
 *
 * @param {HTMLElement} container - Контейнер для вставки.
 */
function renderAttention(container) {
  const attention = el("div", { class: "attention" });
  const overdueTasks = state.tasks.filter(isTaskOverdue);
  const soonTasks = state.tasks.filter(isTaskDueSoon);

  if (overdueTasks.length > 0) {
    attention.appendChild(
      buildAttentionSection(
        `Просроченные (${overdueTasks.length})`,
        overdueTasks,
      ),
    );
  }

  if (soonTasks.length > 0) {
    attention.appendChild(
      buildAttentionSection(`Скоро истекают (${soonTasks.length})`, soonTasks),
    );
  }

  if (overdueTasks.length === 0 && soonTasks.length === 0) {
    attention.appendChild(
      el("div", { class: "empty" }, [
        el("div", { class: "empty-emoji", text: "✅" }),
        el("h1", { class: "empty-title", text: "Всё под контролем" }),
        el("p", {
          class: "empty-text",
          text: "Нет записей, требующих внимания.",
        }),
      ]),
    );
  }

  container.appendChild(attention);
}

/**
 * Создаёт секцию внимания с заголовком и списком задач.
 *
 * @param {string} title - Заголовок секции.
 * @param {Array<object>} tasks - Массив задач.
 * @returns {HTMLElement} Секция внимания.
 */
function buildAttentionSection(title, tasks) {
  const section = el("div", { class: "attention-section" });
  section.appendChild(
    el("div", { class: "attention-head" }, [
      el("h2", { class: "attention-title", text: title }),
    ]),
  );

  const list = el("div", { class: "records-list" });
  tasks.slice(0, MAX_ATTENTION_TASKS).forEach((task) => {
    list.appendChild(renderRecordRow(task));
  });

  section.appendChild(list);
  return section;
}


/**
 * Полностью очищает корзину, безвозвратно удаляя все задачи с флагом deleted_at.
 * Запрашивает подтверждение пользователя перед выполнением.
 */
async function clearAllTrash() {
  const trashTasks = state.tasks.filter((t) => t.deleted_at);
  if (!trashTasks.length) return;

  const ok = await confirmDialog({
    title: "Очистить корзину?",
    message: `Все записи (${trashTasks.length}) будут удалены навсегда.`,
    confirmText: "Очистить",
    danger: true,
  });

  if (!ok) return;

  // Используем Promise.allSettled, чтобы не прерывать удаление при ошибке для одной задачи
  await Promise.allSettled(
    trashTasks.map((task) => api.permanentDeleteTask(task.id)),
  );

  toast("Корзина очищена", "success");
  await refreshTasks();
}