/**
 * @file Модуль рендеринга календаря (неделя, месяц, год).
 * @description Отрисовка сеток, навигация между периодами, обработка кликов по ячейкам.
 */

import { $, el } from "../core/dom.js";
import { icon } from "../core/icons.js";
import {
  getDueState,
  formatTime,
  pad,
  dateKey,
  getWeekStart,
} from "../core/dates.js";
import {
  state,
  WEEKDAYS,
  MONTHS,
  MOBILE_BREAKPOINT,
  isTaskOverdue,
  dueStateToCardClass,
} from "../state/state.js";
import { renderTopbar } from "./renderLayout.js";
import { renderContent } from "./renderContent.js";
import { openTaskPanel } from "../features/taskPanel.js";
import { refreshTasks } from "../features/auth.js";
import { renderWeekGrid } from "./calendarWeekGrid.js";


const CALENDAR_VIEW_MODES = Object.freeze([
  { id: "week", label: "Неделя" },
  { id: "month", label: "Месяц" },
  { id: "year", label: "Год" },
]);

const isMobile = () => window.matchMedia(MOBILE_BREAKPOINT).matches;
const isWeekendDate = (date) => {
  const day = date.getDay();
  return day === 0 || day === 6;
};

let activeMonthPlus = null;
let isMonthGlobalListenersAttached = false;


/**
 * Смещает курсор календаря на указанный период.
 * @param {number} direction - Направление (-1 или 1).
 */
export function navigateCalendar(direction) {
  const mode = state.calendarViewMode || "month";
  const cursor = state.calendarCursor;

  if (mode === "week") {
    state.calendarCursor = new Date(
      cursor.getFullYear(),
      cursor.getMonth(),
      cursor.getDate() + direction * 7,
    );
  } else if (mode === "month") {
    state.calendarCursor = new Date(
      cursor.getFullYear(),
      cursor.getMonth() + direction,
      1,
    );
  } else {
    state.calendarCursor = new Date(cursor.getFullYear() + direction, 0, 1);
  }

  renderTopbar();
  renderContent();
}

/**
 * Рендерит календарь в указанный контейнер.
 * @param {HTMLElement} container - Контейнер для вставки.
 * @param {number|null} [restoreScrollTop=null] - Позиция скролла для восстановления.
 */
export function renderDates(container, restoreScrollTop = null) {
  const calendarEl = renderCalendar(restoreScrollTop);
  container.appendChild(calendarEl);
}

/**
 * Создаёт и возвращает DOM-элемент календаря.
 * @param {number|null} [restoreScrollTop=null] - Позиция скролла для восстановления.
 * @returns {HTMLElement} Элемент календаря.
 */
export function renderCalendar(restoreScrollTop = null) {
  const viewMode = state.calendarViewMode || "month";
  const cursor = state.calendarCursor;
  const calendar = el("div", { class: "calendar" });

  const header = el("div", { class: "calendar-header" });
  const navGroup = el("div", { class: "calendar-nav-group" });

  navGroup.appendChild(
    el(
      "button",
      {
        class: "icon-btn",
        "aria-label": "Назад",
        onclick: () => navigateCalendar(-1),
      },
      [icon("chevron-left", 20)],
    ),
  );
  navGroup.appendChild(
    el(
      "button",
      {
        class: "icon-btn",
        "aria-label": "Вперёд",
        onclick: () => navigateCalendar(1),
      },
      [icon("chevron-right", 20)],
    ),
  );
  header.appendChild(navGroup);

  const viewSwitcher = el("div", { class: "calendar-view-switcher" });
  CALENDAR_VIEW_MODES.forEach((mode) => {
    viewSwitcher.appendChild(
      el("button", {
        class: `calendar-view-btn${viewMode === mode.id ? " is-active" : ""}`,
        text: mode.label,
        onclick: () => {
          state.calendarViewMode = mode.id;
          if (mode.id === "week")
            state.calendarCursor = getWeekStart(new Date());
          renderTopbar();
          renderContent();
        },
      }),
    );
  });
  header.appendChild(viewSwitcher);
  calendar.appendChild(header);

  // Body
  const mobileMode = isMobile();
  if (viewMode === "week") {
    calendar.appendChild(renderCalendarWeek(cursor, restoreScrollTop));
  } else if (viewMode === "month") {
    calendar.appendChild(renderCalendarMonth(cursor, mobileMode));
  } else {
    calendar.appendChild(renderCalendarYear(cursor));
  }

  return calendar;
}


/**
 * Рендерит недельную сетку, делегируя отрисовку в calendarWeekGrid.js.
 * @param {Date} cursor - Текущая дата курсора.
 * @param {number|null} [restoreScrollTop=null] - Позиция скролла.
 * @returns {HTMLElement} Элемент недельной сетки.
 */
export function renderCalendarWeek(cursor, restoreScrollTop = null) {
  const weekStart = getWeekStart(cursor);

  const onUpdate = async (scrollTop = null) => {
    await refreshTasks();
    renderTopbar();
    // Передаём scrollTop через renderContent -> renderDates -> renderCalendarWeek
    renderContent(scrollTop);
  };

  return renderWeekGrid(weekStart, state.tasks, onUpdate, restoreScrollTop);
}


/** Удаляет активную кнопку «+» из ячейки месяца. */
function removeMonthPlus() {
  if (activeMonthPlus && activeMonthPlus.parentNode) {
    activeMonthPlus.parentNode.removeChild(activeMonthPlus);
  }
  activeMonthPlus = null;
}

/** Навешивает глобальные слушатели для закрытия кнопки «+» (вызывается один раз). */
function attachMonthGlobalListeners() {
  if (isMonthGlobalListenersAttached) return;
  isMonthGlobalListenersAttached = true;

  document.addEventListener("click", (e) => {
    if (activeMonthPlus && !e.target.closest(".calendar-cell"))
      removeMonthPlus();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && activeMonthPlus) removeMonthPlus();
  });
}

/**
 * Рендерит сетку месяца.
 * @param {Date} cursor - Текущая дата курсора.
 * @param {boolean} [compact=false] - Компактный режим (для мобильных).
 * @returns {HTMLElement} Элемент сетки месяца.
 */
export function renderCalendarMonth(cursor, compact = false) {
  removeMonthPlus();
  attachMonthGlobalListeners();

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = (firstDay.getDay() + 6) % 7;
  const todayKey = dateKey(new Date());

  const monthWrap = el("div", {
    class: compact ? "calendar-month calendar-month-compact" : "calendar-month",
  });
  monthWrap.appendChild(
    el("div", {
      class: "calendar-month-title",
      text: `${MONTHS[month]} ${year}`,
    }),
  );

  const weekdays = el("div", { class: "calendar-weekdays" });
  WEEKDAYS.forEach((wd, i) => {
    const isWeekend = i === 5 || i === 6;
    weekdays.appendChild(
      el("div", {
        class: `calendar-weekday${isWeekend ? " is-weekend" : ""}`,
        text: compact ? wd[0] : wd,
      }),
    );
  });
  monthWrap.appendChild(weekdays);

  const grid = el("div", { class: "calendar-grid" });
  for (let i = 0; i < offset; i++) {
    grid.appendChild(el("div", { class: "calendar-cell calendar-cell-empty" }));
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${year}-${pad(month + 1)}-${pad(day)}`;
    const dayTasks = state.tasks
      .filter((t) => t.due_at && dateKey(t.due_at) === key && !t.deleted_at)
      .sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)));

    const isToday = key === todayKey;
    const dateObj = new Date(year, month, day);
    const isWeekend = isWeekendDate(dateObj);

    const cell = el("div", {
      class: `calendar-cell${isToday ? " calendar-cell-today" : ""}${isWeekend ? " is-weekend" : ""}`,
      tabindex: 0,
      role: "button",
      "aria-label": `${day} ${MONTHS[month]} ${year}`,
    });

    cell.appendChild(
      el("div", {
        class: `calendar-day-number${isToday ? " is-today" : ""}${isWeekend ? " is-weekend" : ""}`,
        text: String(day),
      }),
    );

    if (!compact) {
      appendMonthTasks(cell, dayTasks);
    } else if (dayTasks.length > 0) {
      cell.appendChild(
        el("div", {
          class: `calendar-day-indicator${dayTasks.some(isTaskOverdue) ? " has-overdue" : ""}`,
          text: String(dayTasks.length),
        }),
      );
    }

    cell.addEventListener("click", (e) => {
      if (
        e.target.closest(".calendar-event") ||
        e.target.closest(".month-plus-btn")
      )
        return;
      removeMonthPlus();

      const plusBtn = el("button", {
        class: "month-plus-btn",
        type: "button",
        "aria-label": "Создать задачу",
      });
      plusBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;

      plusBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        removeMonthPlus();
        openTaskPanel(null, "edit", { dueAt: `${key}T12:00` });
      });

      cell.appendChild(plusBtn);
      activeMonthPlus = plusBtn;
    });

    grid.appendChild(cell);
  }

  monthWrap.appendChild(grid);
  return monthWrap;
}

/**
 * Добавляет превью задач в ячейку месяца (максимум 3, далее счётчик).
 * @param {HTMLElement} cell - Ячейка дня.
 * @param {object[]} dayTasks - Массив задач.
 */
function appendMonthTasks(cell, dayTasks) {
  dayTasks.slice(0, 3).forEach((task) => {
    const due = getDueState(task);
    const chipClass = [
      "calendar-event",
      task.status === "done" ? "is-done" : "",
      dueStateToCardClass(due.state),
    ]
      .filter(Boolean)
      .join(" ");
    const time = task.due_at ? formatTime(new Date(task.due_at)) : "";

    cell.appendChild(
      el(
        "button",
        {
          class: chipClass,
          title: task.title,
          onclick: (e) => {
            e.stopPropagation();
            openTaskPanel(task.id, "view");
          },
        },
        [
          time
            ? el("span", { class: "calendar-event-time", text: time })
            : null,
          el("span", { class: "calendar-event-title", text: task.title }),
        ].filter(Boolean),
      ),
    );
  });

  if (dayTasks.length > 3) {
    cell.appendChild(
      el("div", { class: "calendar-more", text: `+${dayTasks.length - 3}` }),
    );
  }
}


/**
 * Рендерит сетку года (12 мини-месяцев).
 * @param {Date} cursor - Текущая дата курсора.
 * @returns {HTMLElement} Элемент сетки года.
 */
export function renderCalendarYear(cursor) {
  const year = cursor.getFullYear();
  const grid = el("div", { class: "calendar-year-grid" });

  const tasksByDate = new Map();
  state.tasks.forEach((task) => {
    if (!task.due_at || task.deleted_at) return;
    const key = dateKey(task.due_at);
    if (!tasksByDate.has(key)) tasksByDate.set(key, []);
    tasksByDate.get(key).push(task);
  });

  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();

  for (let month = 0; month < 12; month++) {
    const isCurrentMonth = year === currentYear && month === currentMonth;
    const monthCard = el("button", {
      class: `calendar-year-month${isCurrentMonth ? " is-current" : ""}`,
      type: "button",
      "aria-label": `${MONTHS[month]} ${year}`,
      onclick: () => {
        state.calendarViewMode = "month";
        state.calendarCursor = new Date(year, month, 1);
        renderTopbar();
        renderContent();
      },
    });

    monthCard.appendChild(
      el("div", { class: "calendar-year-month-title", text: MONTHS[month] }),
    );
    monthCard.appendChild(renderMiniMonth(year, month, tasksByDate));
    grid.appendChild(monthCard);
  }

  return grid;
}

/**
 * Рендерит компактную сетку одного месяца для годового вида.
 * @param {number} year - Год.
 * @param {number} month - Месяц (0-11).
 * @param {Map<string, object[]>} tasksByDate - Карта задач по датам.
 * @returns {HTMLElement} Элемент мини-месяца.
 */
export function renderMiniMonth(year, month, tasksByDate) {
  const wrap = el("div", {
    class: "calendar-year-mini",
    "aria-hidden": "true",
  });

  const weekdays = el("div", { class: "calendar-year-weekdays" });
  WEEKDAYS.forEach((d, i) => {
    const isWeekend = i === 5 || i === 6;
    weekdays.appendChild(
      el("span", { class: isWeekend ? "is-weekend" : "", text: d[0] }),
    );
  });
  wrap.appendChild(weekdays);

  const days = el("div", { class: "calendar-year-days" });
  const firstDay = new Date(year, month, 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = dateKey(new Date());

  for (let i = 0; i < offset; i++) {
    days.appendChild(el("span", { class: "calendar-year-day is-empty" }));
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${year}-${pad(month + 1)}-${pad(day)}`;
    const dayTasks = tasksByDate.get(key) || [];
    const hasOverdue = dayTasks.some(isTaskOverdue);
    const isToday = key === todayKey;
    const dateObj = new Date(year, month, day);
    const isWeekend = isWeekendDate(dateObj);

    const classes = ["calendar-year-day"];
    if (dayTasks.length > 0) classes.push("has-tasks");
    if (hasOverdue) classes.push("has-overdue");
    if (isToday) classes.push("is-today");
    if (isWeekend) classes.push("is-weekend");

    days.appendChild(
      el("span", { class: classes.join(" "), text: String(day) }),
    );
  }

  wrap.appendChild(days);
  return wrap;
}