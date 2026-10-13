/**
 * @file Модальное окно Command Palette (Ctrl/Cmd+K).
 * @description Обеспечивает быстрый поиск записей и выполнение глобальных действий
 *              (переключение темы, разделов, создание задач).
 *              Использует debounce для оптимизации поисковых запросов к API
 *              и счётчик запросов для предотвращения race conditions при быстром вводе.
 */

import { el, clear, debounce } from "../../core/dom.js";
import { state, RECORDS_VIEWS } from "../../state/state.js";
import { getDueState } from "../../core/dates.js";
import { api } from "../../storage/api.js";
import { toggleTheme, loadTasks } from "../auth.js";
import { renderAll } from "../../app/app.js";
import { openTaskPanel } from "../taskPanel.js";
import { closeSidebar } from "./sidebar.js";

const SEARCH_DEBOUNCE_MS = 120;
const MAX_ACTIONS_DISPLAY = 12;
const MAX_TASKS_DISPLAY = 10;
const DEFAULT_RECENT_TASKS = 8;

/**
 * Открывает Command Palette с полем ввода и списком результатов.
 * Автоматически фокусирует поле ввода и закрывается по Escape или клику вне палитры.
 *
 * @returns {void}
 */
export function openPalette() {
  const overlay = el("div", { class: "palette-overlay" });
  const input = el("input", {
    class: "palette-input",
    placeholder: "Поиск записей и действий…",
    "aria-label": "Быстрый поиск",
  });
  const list = el("div", { class: "palette-list" });
  const palette = el("div", { class: "palette" }, [input, list]);

  overlay.appendChild(palette);

  let isClosed = false;
  // Счётчик запросов для предотвращения race conditions:
  // если пользователь быстро печатает, медленный API-запрос по старому тексту
  // не должен перезаписывать результаты нового запроса.
  let currentQueryId = 0;

  const close = () => {
    if (isClosed) return;
    isClosed = true;
    overlay.remove();
    document.removeEventListener("keydown", onKeydown);
  };

  const onKeydown = (e) => {
    if (e.key === "Escape") close();
  };

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });

  document.addEventListener("keydown", onKeydown);
  document.body.appendChild(overlay);
  input.focus();

  /**
   * Асинхронно обновляет список действий и задач в палитре.
   * Проверяет актуальность запроса перед вставкой результатов в DOM.
   *
   * @returns {Promise<void>}
   */
  const renderResults = async () => {
    if (isClosed) return;

    const queryId = ++currentQueryId;
    const query = input.value.trim().toLowerCase();

    clear(list);

    // 1. Рендерим доступные глобальные действия
    const actions = getPaletteActions().filter((a) =>
      a.label.toLowerCase().includes(query),
    );

    if (actions.length) {
      list.appendChild(
        el("div", { class: "palette-section-title", text: "Действия" }),
      );
      actions.slice(0, MAX_ACTIONS_DISPLAY).forEach((action) => {
        list.appendChild(
          el(
            "button",
            {
              class: "palette-item",
              onclick: () => {
                close();
                action.onClick();
              },
            },
            [
              el(
                "div",
                { class: "palette-item-main" },
                [
                  el("span", {
                    class: "palette-item-title",
                    text: action.label,
                  }),
                  action.subtitle
                    ? el("span", {
                        class: "palette-item-subtitle",
                        text: action.subtitle,
                      })
                    : null,
                ].filter(Boolean),
              ),
            ],
          ),
        );
      });
    }

    // 2. Рендерим задачи (поиск через API или локальный кэш)
    let tasks = [];
    if (query) {
      try {
        tasks = await api.search(state.workspaceId, query);
      } catch {
        tasks = [];
      }
    } else {
      tasks = state.tasks.slice(0, DEFAULT_RECENT_TASKS);
    }

    // Если за время ожидания запроса палитра закрылась или пользователь ввёл новый текст — игнорируем результат
    if (isClosed || queryId !== currentQueryId) return;

    if (tasks.length) {
      list.appendChild(
        el("div", { class: "palette-section-title", text: "Записи" }),
      );
      tasks.slice(0, MAX_TASKS_DISPLAY).forEach((task) => {
        const due = getDueState(task);
        list.appendChild(
          el(
            "button",
            {
              class: "palette-item",
              onclick: () => {
                close();
                openTaskPanel(task.id, "view");
              },
            },
            [
              el("div", { class: "palette-item-main" }, [
                el("span", { class: "palette-item-title", text: task.title }),
                el("span", {
                  class: "palette-item-subtitle",
                  text: [task.type_name || "Без типа", due.label].join(" · "),
                }),
              ]),
            ],
          ),
        );
      });
    }

    if (!actions.length && !tasks.length) {
      list.appendChild(
        el("div", { class: "palette-empty", text: "Ничего не нашлось." }),
      );
    }
  };

  input.addEventListener(
    "input",
    debounce(() => renderResults(), SEARCH_DEBOUNCE_MS),
  );
  renderResults();
}

/**
 * Формирует список глобальных действий для Command Palette.
 * Включает навигацию по разделам, создание задач и переключение темы.
 *
 * @returns {Array<{label: string, subtitle: string, onClick: Function}>}
 */
function getPaletteActions() {
  const viewActions = RECORDS_VIEWS.map((view) => ({
    label: `Перейти: ${view.label}`,
    subtitle: "Раздел записей",
    onClick: () => {
      state.recordsView = view.id;
      state.statusFilter = "";
      state.sidebarTab = "records";
      renderAll();
      loadTasks();
      closeSidebar();
    },
  }));

  return [
    {
      label: "Новая запись",
      subtitle: "Быстрое действие",
      onClick: () => openTaskPanel(null, "edit"),
    },
    {
      label: "Переключить тему",
      subtitle: "Оформление",
      onClick: () => toggleTheme(),
    },
    {
      label: "Рабочие пространства",
      subtitle: "Переключение",
      onClick: () => {
        // Динамический импорт используется для разрыва циклической зависимости:
        // modals.js -> palette.js -> modals.js
        import("../modals.js").then((modules) => {
          modules.openWorkspaceSwitcher();
        });
      },
    },
    ...viewActions,
  ];
}