/**
 * @file Глобальное состояние приложения и вспомогательные селекторы.
 * @description Содержит все константы (представления, метки, цвета, тексты пустых состояний),
 *              единый объект `state` (мутируется напрямую, без реактивных фреймворков)
 *              и функции-селекторы для фильтрации, сортировки и определения состояний задач.
 *              Перерисовка DOM инициируется явными вызовами render-функций.
 */

import { getDueState } from "../core/dates.js";

/**
 * Брейкпоинт для определения мобильного устройства.
 *
 * @type {string}
 */
export const MOBILE_BREAKPOINT = "(max-width: 767.98px)";

/**
 * Список представлений (views) для вкладки "Записи".
 *
 * @type {ReadonlyArray<{id: string, label: string, icon: string}>}
 */
export const RECORDS_VIEWS = Object.freeze([
  { id: "all", label: "Все записи", icon: "inbox" },
  { id: "today", label: "Сегодня", icon: "clock" },
  { id: "upcoming", label: "Предстоящие", icon: "calendar" },
  { id: "pinned", label: "Избранное", icon: "star" },
  { id: "trash", label: "Корзина", icon: "trash" },
]);

/**
 * Опции фильтра по статусу задачи.
 *
 * @type {ReadonlyArray<{value: string, label: string}>}
 */
export const STATE_FILTER_OPTIONS = Object.freeze([
  { value: "", label: "Все" },
  { value: "todo", label: "К выполнению" },
  { value: "in_progress", label: "В работе" },
  { value: "done", label: "Выполнено" },
  { value: "overdue", label: "Просроченные" },
]);

/**
 * Текстовые метки приоритетов задач.
 *
 * @type {Readonly<Record<number, string>>}
 */
export const PRIORITY_LABELS = Object.freeze({
  1: "Низкий",
  2: "Средний",
  3: "Высокий",
  4: "Срочный",
});

/**
 * Текстовые метки статусов задач.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const STATUS_LABELS = Object.freeze({
  todo: "К выполнению",
  in_progress: "В работе",
  done: "Выполнено",
});

/**
 * Сокращённые названия дней недели (понедельник — воскресенье).
 *
 * @type {ReadonlyArray<string>}
 */
export const WEEKDAYS = Object.freeze([
  "Пн",
  "Вт",
  "Ср",
  "Чт",
  "Пт",
  "Сб",
  "Вс",
]);

/**
 * Полные названия месяцев.
 *
 * @type {ReadonlyArray<string>}
 */
export const MONTHS = Object.freeze([
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
]);

/**
 * Палитра цветов для типов задач (тёмные и нейтральные оттенки).
 *
 * @type {ReadonlyArray<string>}
 */
export const TYPE_COLORS = Object.freeze([
  "#201D18",
  "#6F6A63",
  "#9A7400",
  "#A63A2E",
  "#3A7D46",
  "#5582B3",
  "#7A4A99",
  "#99527A",
]);

/**
 * Палитра ярких цветов для типов задач (используется при случайном выборе).
 *
 * @type {ReadonlyArray<string>}
 */
export const BRIGHT_TYPE_COLORS = Object.freeze([
  "#A63A2E",
  "#3A7D46",
  "#5582B3",
  "#7A4A99",
  "#99527A",
  "#9A7400",
]);

/**
 * Тексты и эмодзи для пустых состояний (empty states).
 *
 * @type {Readonly<Record<string, {emoji: string, title: string, text: string}>>}
 */
export const EMPTY_TEXTS = Object.freeze({
  all: {
    emoji: "📭",
    title: "Пока чисто",
    text: "Самое время запланировать день.",
  },
  today: { emoji: "☀️", title: "На сегодня задач нет", text: "Хороший знак." },
  upcoming: {
    emoji: "📅",
    title: "Впереди ничего нет",
    text: "Можно выдохнуть.",
  },
  pinned: {
    emoji: "⭐",
    title: "Избранное пусто",
    text: "Отмечайте важное звёздочкой.",
  },
  trash: {
    emoji: "🗑️",
    title: "Корзина пуста",
    text: "Удалённые задачи будут здесь.",
  },
  search: {
    emoji: "🔍",
    title: "Ничего не нашлось",
    text: "Попробуйте другую формулировку.",
  },
  filter: {
    emoji: "🧹",
    title: "Ничего не найдено",
    text: "По выбранным фильтрам записей нет.",
  },
});

/**
 * Ключи для хранения данных в localStorage.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const STORAGE_KEYS = Object.freeze({
  token: "irsalio_token",
  mode: "irsalio_mode",
  workspaceId: "irsalio_workspace_id",
  theme: "irsalio_theme",
});


const now = new Date();

/**
 * Глобальное состояние приложения.
 * Мутируется напрямую (без Redux/Vuex), так как приложение не использует реактивные фреймворки.
 * Перерисовка DOM инициируется явными вызовами render-функций.
 *
 * @type {object}
 */
export const state = {
  user: null,
  workspaces: [],
  workspaceId: localStorage.getItem(STORAGE_KEYS.workspaceId) || null,
  types: [],
  tasks: [],

  sidebarTab: "records",
  recordsView: "all",
  statusFilter: "",
  search: "",
  sort: "created_at",
  order: "desc",
  typeId: "",

  editingTaskId: null,
  newTaskDefaults: {},

  calendarCursor: new Date(now.getFullYear(), now.getMonth(), 1),
  calendarViewMode: "month",

  theme: localStorage.getItem(STORAGE_KEYS.theme) || "light",

  panelMode: null,
  panelDirty: false,
};


/**
 * Объединяет два массива задач, дедуплицируя по ID.
 * При совпадении ID приоритет отдаётся задаче из второго массива (b).
 *
 * @param {Array<object>} a - Первый массив задач.
 * @param {Array<object>} b - Второй массив задач.
 * @returns {Array<object>} Объединённый массив без дубликатов.
 */
export function mergeTasks(a, b) {
  const map = new Map();
  for (const t of a) map.set(t.id, t);
  for (const t of b) map.set(t.id, t);
  return Array.from(map.values());
}

/**
 * Сортирует задачи по принципу: просроченные → активные → выполненные.
 * Используется для интеллектуального отображения в списках и дашборде.
 *
 * @param {Array<object>} tasks - Массив задач.
 * @returns {Array<object>} Отсортированный массив.
 */
export function smartSortTasks(tasks) {
  const overdue = [];
  const active = [];
  const done = [];

  for (const t of tasks) {
    if (t.status === "done") {
      done.push(t);
    } else if (!t.deleted_at && isTaskOverdue(t)) {
      overdue.push(t);
    } else {
      active.push(t);
    }
  }

  return [...overdue, ...active, ...done];
}

/**
 * Возвращает задачи с учётом глобального фильтра по статусу.
 * Если фильтр не задан или выбрана вкладка "Корзина", возвращает все задачи.
 *
 * @returns {Array<object>} Отфильтрованный массив задач.
 */
export function getFilteredTasks() {
  if (state.recordsView === "trash") return state.tasks;
  if (!state.statusFilter) return state.tasks;
  if (state.statusFilter === "overdue")
    return state.tasks.filter(isTaskOverdue);
  return state.tasks.filter((t) => t.status === state.statusFilter);
}

/**
 * Проверяет, направлен ли фокус на редактируемый элемент (input, textarea и т.д.).
 * Необходимо для блокировки глобальных горячих клавиш при вводе текста.
 *
 * @param {Event} event - Объект события.
 * @returns {boolean} True, если элемент редактируемый.
 */
export function isEditableTarget(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;

  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * Возвращает CSS-класс для карточки задачи в зависимости от состояния срока.
 *
 * @param {string} state - Состояние срока (none, normal, due-soon, overdue).
 * @returns {string} CSS-класс или пустая строка.
 */
export function dueStateToCardClass(state) {
  if (state === "overdue") return "is-overdue";
  if (state === "due-soon") return "is-due-soon";
  return "";
}

/**
 * Возвращает CSS-класс для бейджа срока в зависимости от состояния.
 *
 * @param {string} state - Состояние срока.
 * @returns {string} CSS-класс или пустая строка.
 */
export function dueStateToBadgeClass(state) {
  if (state === "overdue") return "badge-danger";
  if (state === "due-soon") return "badge-warning";
  return "";
}

/**
 * Проверяет, просрочена ли задача.
 * Задача считается просроченной, если у неё есть срок, она не выполнена,
 * не удалена и её состояние равно 'overdue'.
 *
 * @param {object} task - Объект задачи.
 * @returns {boolean} True, если задача просрочена.
 */
export function isTaskOverdue(task) {
  if (!task.due_at || task.status === "done" || task.deleted_at) return false;
  return getDueState(task).state === "overdue";
}

/**
 * Проверяет, скоро ли истекает срок задачи.
 *
 * @param {object} task - Объект задачи.
 * @returns {boolean} True, если срок скоро истекает.
 */
export function isTaskDueSoon(task) {
  if (!task.due_at || task.status === "done" || task.deleted_at) return false;
  return getDueState(task).state === "due-soon";
}