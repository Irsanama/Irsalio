/**
 * @file Утилиты для работы с датами и временем в локальном часовом поясе.
 * @description Обеспечивают корректное форматирование, парсинг и вычисление состояний
 *              сроков задач. Все операции выполняются в локальном часовом поясе браузера,
 *              без использования UTC-методов, чтобы избежать сдвига дат при отображении.
 */

const MONTHS_SHORT = [
  "янв",
  "фев",
  "мар",
  "апр",
  "мая",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/**
 * Форматирует дату для input[type="datetime-local"].
 * Ручное форматирование объектов Date предотвращает ошибки обрезки
 * не-ISO строк (например, "Mon Oct 12..." вместо "2023-10-12T...").
 *
 * @param {string|Date|null|undefined} value - Входное значение даты.
 * @returns {string} Строка в формате YYYY-MM-DDTHH:mm или пустая строка.
 */
export function toDatetimeLocalValue(value) {
  if (!value) return "";

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    const h = String(value.getHours()).padStart(2, "0");
    const min = String(value.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${d}T${h}:${min}`;
  }

  const str = String(value);
  if (str.length >= 16 && str.includes("T")) {
    return str.slice(0, 16);
  }

  return str;
}

/**
 * Парсит строку, число или объект Date в локальный объект Date.
 *
 * @param {string|number|Date|null|undefined} value - Входное значение.
 * @returns {Date|null} Объект Date или null, если значение невалидно.
 */
export function parseLocalDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }

  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === "string") {
    const m = value.match(
      /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/,
    );
    if (m) {
      const [, y, mo, d, h, mi, s] = m;
      const date = new Date(
        Number(y),
        Number(mo) - 1,
        Number(d),
        Number(h),
        Number(mi),
        Number(s || 0),
      );
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const dm = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dm) {
      const [, y, mo, d] = dm;
      const date = new Date(Number(y), Number(mo) - 1, Number(d));
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const f = new Date(value);
    return Number.isNaN(f.getTime()) ? null : f;
  }

  return null;
}

/**
 * Возвращает начало переданного дня (00:00:00).
 *
 * @param {Date} date - Исходная дата.
 * @returns {Date} Начало дня.
 */
export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Вычисляет разницу в днях между двумя датами.
 *
 * @param {Date} from - Начальная дата.
 * @param {Date} to - Конечная дата.
 * @returns {number} Количество полных дней.
 */
export function dayOffset(from, to) {
  const fromDay = startOfDay(from).getTime();
  const toDay = startOfDay(to).getTime();
  return Math.round((toDay - fromDay) / MS_PER_DAY);
}

/**
 * Проверяет, совпадают ли две даты (игнорируя время).
 *
 * @param {Date} a - Первая дата.
 * @param {Date} b - Вторая дата.
 * @returns {boolean} True, если даты совпадают.
 */
export function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Форматирует дату в читаемый вид: "12 окт · 14:30".
 *
 * @param {Date} date - Дата для форматирования.
 * @returns {string} Отформатированная строка.
 */
export function formatDueDate(date) {
  const d = date.getDate();
  const m = MONTHS_SHORT[date.getMonth()];
  const time = date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${d} ${m} · ${time}`;
}

/**
 * Форматирует только время: "14:30".
 *
 * @param {Date} date - Дата для форматирования.
 * @returns {string} Время в формате ЧЧ:ММ.
 */
export function formatTime(date) {
  return date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Определяет состояние срока задачи относительно текущего времени.
 * Используется для цветовой индикации карточек и бейджей.
 *
 * Логика:
 * 1. Просрочено: now >= overdueDate
 * 2. Идёт: now >= due_at и now < overdueDate (показывает "Идёт · Осталось X мин/ч")
 * 3. Ещё не началась: now < due_at (показывает "Через X мин/ч" или "Сегодня/Завтра")
 *
 * @param {object} task - Объект задачи.
 * @returns {{ state: 'none'|'normal'|'due-soon'|'overdue', label: string }} Состояние и текстовая метка.
 */
export function getDueState(task) {
  if (!task.due_at) return { state: "none", label: "Без срока" };

  const due = parseLocalDate(task.due_at);
  if (!due) return { state: "none", label: "Без срока" };

  if (task.status === "done") {
    return { state: "normal", label: formatDueDate(due) };
  }

  const now = new Date();
  const parsedEnd = task.due_end_at ? parseLocalDate(task.due_end_at) : null;
  const overdueDate = parsedEnd || due;

  if (now >= overdueDate) {
    const absMs = now - overdueDate;
    const absMin = Math.max(1, Math.round(absMs / MS_PER_MINUTE));
    const absHour = Math.round(absMs / MS_PER_HOUR);
    const absDay = Math.round(absMs / MS_PER_DAY);

    let label;
    if (absMin < 60) label = `Просрочено · ${absMin} мин`;
    else if (absHour < 24) label = `Просрочено · ${absHour} ч`;
    else label = `Просрочено · ${absDay} дн`;

    return { state: "overdue", label };
  }

  if (now >= due && now < overdueDate) {
    const remainingMs = overdueDate - now;
    const remMin = Math.max(1, Math.round(remainingMs / MS_PER_MINUTE));
    const remHour = Math.round(remainingMs / MS_PER_HOUR);

    if (remMin < 60) {
      return { state: "due-soon", label: `Идёт · Осталось ${remMin} мин` };
    }
    if (remHour < 24) {
      return { state: "due-soon", label: `Идёт · Осталось ${remHour} ч` };
    }
    return { state: "due-soon", label: `Идёт` };
  }

  const diffMs = due - now;
  const offset = dayOffset(now, due);

  if (offset === 0) {
    const time = formatTime(due);
    const diffMin = Math.max(1, Math.round(diffMs / MS_PER_MINUTE));
    const diffHour = Math.round(diffMs / MS_PER_HOUR);

    if (diffMin < 60)
      return { state: "due-soon", label: `Через ${diffMin} мин · ${time}` };
    if (diffHour <= 3)
      return { state: "due-soon", label: `Через ${diffHour} ч · ${time}` };
    return { state: "due-soon", label: `Сегодня · ${time}` };
  }

  if (offset === 1)
    return { state: "due-soon", label: `Завтра · ${formatTime(due)}` };

  return { state: "normal", label: formatDueDate(due) };
}

/**
 * Дополняет число нулём слева до 2 символов.
 *
 * @param {number|string} v - Число или строка.
 * @returns {string} Дополненная строка.
 */
export function pad(v) {
  return String(v).padStart(2, "0");
}

/**
 * Возвращает строковый ключ даты в формате YYYY-MM-DD.
 * Используется для группировки задач по дням в календаре.
 *
 * @param {string|Date} value - Дата.
 * @returns {string} Ключ даты.
 */
export function dateKey(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Возвращает дату начала недели (понедельник) для переданной даты.
 *
 * @param {Date} date - Исходная дата.
 * @returns {Date} Начало недели.
 */
export function getWeekStart(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

/**
 * Форматирует диапазон дат выполнения задачи.
 *
 * @param {string|Date|null} dueAt - Начало диапазона.
 * @param {string|Date|null} dueEndAt - Конец диапазона.
 * @returns {string} Отформатированный диапазон или пустая строка.
 */
export function formatDueRange(dueAt, dueEndAt) {
  const d1 = parseLocalDate(dueAt);
  const d2 = parseLocalDate(dueEndAt);

  if (!d1) return "";

  const day1 = d1.getDate();
  const month1 = MONTHS_SHORT[d1.getMonth()];
  const time1 = formatTime(d1);

  if (!d2) return `${day1} ${month1}, ${time1}`;

  const time2 = formatTime(d2);
  if (isSameDay(d1, d2)) return `${day1} ${month1}, ${time1} – ${time2}`;

  const day2 = d2.getDate();
  const month2 = MONTHS_SHORT[d2.getMonth()];
  return `${day1} ${month1} ${time1} – ${day2} ${month2} ${time2}`;
}

/**
 * Возвращает количество минут с начала суток.
 *
 * @param {Date} date - Дата.
 * @returns {number} Минуты с 00:00.
 */
export function getMinutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Возвращает количество минут с 06:00 (используется в календаре).
 *
 * @param {Date} date - Дата.
 * @returns {number} Минуты с 06:00.
 */
export function getMinutesSince6(date) {
  return getMinutesSinceMidnight(date) - 6 * 60;
}

/**
 * Добавляет указанное количество минут к дате.
 *
 * @param {Date} date - Исходная дата.
 * @param {number} minutes - Количество минут.
 * @returns {Date} Новая дата.
 */
export function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * MS_PER_MINUTE);
}

/**
 * Добавляет указанное количество дней к дате.
 *
 * @param {Date} date - Исходная дата.
 * @param {number} days - Количество дней.
 * @returns {Date} Новая дата.
 */
export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Округляет время даты до ближайшего шага сетки (по умолчанию 15 минут).
 * Используется в календаре для выравнивания блоков задач.
 *
 * @param {Date} date - Исходная дата.
 * @param {number} [stepMinutes=15] - Шаг сетки в минутах.
 * @returns {Date} Округлённая дата.
 */
export function snapToGrid(date, stepMinutes = 15) {
  const d = new Date(date);
  const minutes = d.getMinutes();
  const snapped = Math.round(minutes / stepMinutes) * stepMinutes;
  d.setMinutes(snapped, 0, 0);
  return d;
}

/**
 * Форматирует диапазон времени для отображения в календаре.
 * Если даты в разные дни, добавляет суффикс "+N" к времени окончания.
 *
 * @param {Date} start - Время начала.
 * @param {Date} [end] - Время окончания.
 * @returns {string} Отформатированный диапазон.
 */
export function formatTimeRange(start, end) {
  if (!start) return "";
  const s = formatTime(start);
  if (!end) return s;

  const e = formatTime(end);
  if (isSameDay(start, end)) return `${s} – ${e}`;

  const dayDiff = dayOffset(startOfDay(start), startOfDay(end));
  return `${s} – ${e}${dayDiff > 0 ? `+${dayDiff}` : ""}`;
}