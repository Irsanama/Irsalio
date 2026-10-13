/**
 * @file Модуль рендеринга элементов верхнего уровня (Layout).
 * @description Отвечает за отрисовку топбара, информации о пользователе,
 *              кнопки рабочего пространства и выпадающих фильтров.
 */

import { $, clear, el } from "../core/dom.js";
import { getWeekStart } from "../core/dates.js";
import { pluralizeRecords } from "../core/format.js";
import {
  state,
  RECORDS_VIEWS,
  STATE_FILTER_OPTIONS,
  MONTHS,
  isTaskOverdue,
  isTaskDueSoon,
  getFilteredTasks,
} from "../state/state.js";
import { getStorageMode } from "../storage/api.js";
import { ensureStatusFilter } from "./components.js";

/**
 * Обновляет название текущего рабочего пространства в боковой панели.
 * Если пространство не найдено или не выбрано, отображает заглушку.
 *
 * @returns {void}
 */
export function renderWorkspaceButton() {
  const ws = state.workspaces.find((w) => w.id === state.workspaceId);
  const nameEl = $("#workspace-name");

  if (nameEl) {
    nameEl.textContent = ws?.name || "Пространство";
  }
}

/**
 * Отображает информацию о текущем пользователе (отображаемое имя и логин)
 * в подвале боковой панели.
 *
 * @returns {void}
 */
export function renderUserInfo() {
  const infoEl = $("#user-info");
  if (!infoEl) return;

  if (state.user) {
    infoEl.textContent = `${state.user.displayName} · @${state.user.username}`;
  } else {
    infoEl.textContent = "";
  }
}

/**
 * Полностью перерисовывает верхнюю панель (топбар).
 * Включает заголовки, подзаголовки, видимость инструментов, бейдж режима хранения
 * и индикатор направления сортировки.
 *
 * @returns {void}
 */
export function renderTopbar() {
  const titleEl = $("#topbar-title");
  const subtitleEl = $("#topbar-subtitle");
  const toolsEl = $("#records-tools");

  // --- Заголовки и подзаголовки в зависимости от вкладки ---
  if (state.sidebarTab === "records") {
    const view = RECORDS_VIEWS.find((v) => v.id === state.recordsView);
    if (titleEl) titleEl.textContent = view?.label || "Записи";

    // Формируем подзаголовок с учётом фильтров и количества записей
    const type = state.types.find((t) => t.id === state.typeId);
    const stateOpt = STATE_FILTER_OPTIONS.find(
      (o) => o.value === state.statusFilter,
    );
    const count = getFilteredTasks().length;

    const parts = [];
    if (type) parts.push(`Тип: ${type.name}`);
    if (stateOpt && stateOpt.value) parts.push(stateOpt.label);
    parts.push(`${count} ${pluralizeRecords(count)}`);

    if (subtitleEl) subtitleEl.textContent = parts.join(" · ");
    if (toolsEl) toolsEl.style.display = "flex";
  } else if (state.sidebarTab === "dashboard") {
    if (titleEl) titleEl.textContent = "Дашборд";
    if (subtitleEl) subtitleEl.textContent = "Метрики пространства";
    if (toolsEl) toolsEl.style.display = "none";
  } else if (state.sidebarTab === "dates") {
    const cursor = state.calendarCursor;
    const vm = state.calendarViewMode || "month";

    if (vm === "week") {
      const start = getWeekStart(cursor);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);

      const isSameMonth = start.getMonth() === end.getMonth();
      const rangeText = isSameMonth
        ? `${start.getDate()} — ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`
        : `${start.getDate()} ${MONTHS[start.getMonth()]} — ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;

      if (titleEl) titleEl.textContent = rangeText;
    } else if (vm === "month") {
      if (titleEl)
        titleEl.textContent = `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
    } else {
      if (titleEl) titleEl.textContent = `${cursor.getFullYear()}`;
    }

    if (subtitleEl) subtitleEl.textContent = "Календарь";
    if (toolsEl) toolsEl.style.display = "none";
  } else if (state.sidebarTab === "attention") {
    if (titleEl) titleEl.textContent = "Внимание";

    const attentionCount = state.tasks.filter(
      (t) => isTaskOverdue(t) || isTaskDueSoon(t),
    ).length;
    if (subtitleEl)
      subtitleEl.textContent = `${attentionCount} требуют действий`;
    if (toolsEl) toolsEl.style.display = "none";
  }

  // --- Бейдж режима хранения ---
  const storageModeEl = $("#storage-mode-badge");
  if (storageModeEl) {
    const mode = getStorageMode();
    storageModeEl.classList.toggle("is-local", mode === "local");
    storageModeEl.classList.toggle("is-server", mode === "server");
    storageModeEl.textContent = mode === "local" ? "Локально" : "Сервер";
    storageModeEl.title =
      mode === "local"
        ? "Данные хранятся только в этом браузере"
        : "Данные хранятся на сервере";
  }

  // --- Индикатор сортировки ---
  const orderBtn = $("#order-button");
  if (orderBtn) {
    orderBtn.classList.toggle("is-asc", state.order === "asc");
  }

  // Гарантируем наличие и актуальность фильтра по статусу
  ensureStatusFilter();
}

/**
 * Заполняет выпадающий список фильтрации по типам задач в топбаре.
 * Сохраняет текущее выбранное значение из глобального состояния.
 *
 * @returns {void}
 */
export function renderTypeFilter() {
  const select = $("#type-filter-select");
  if (!select) return;

  clear(select);

  select.appendChild(el("option", { value: "", text: "Все типы" }));

  state.types.forEach((type) => {
    select.appendChild(el("option", { value: type.id, text: type.name }));
  });

  select.value = state.typeId;
}