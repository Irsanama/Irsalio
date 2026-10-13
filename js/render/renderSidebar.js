/**
 * @file Модуль рендеринга боковой панели (Sidebar).
 * @description Отвечает за отрисовку вкладок, тела сайдбара (разделы, типы, описания),
 *              виджета хранения памяти и бейджа внимания.
 */

import { $, clear, el } from "../core/dom.js";
import { icon } from "../core/icons.js";
import {
  state,
  RECORDS_VIEWS,
  isTaskOverdue,
  isTaskDueSoon,
} from "../state/state.js";
import { getStorageMode, getStorageStats } from "../storage/api.js";
import { closeTaskPanel } from "../features/taskPanel.js";
import { openSettings, openTypeEditor } from "../features/modals.js";
import { renderAll } from "../app/app.js";
import { EventBus } from "../core/events.js";
import { renderTopbar, renderTypeFilter } from "./renderLayout.js";
import { closeSidebar } from "../features/modals/sidebar.js";

let storageWidgetPromise = null;

/**
 * Обновляет активное состояние вкладок сайдбара.
 * Устанавливает `aria-current="page"` для активной вкладки.
 */
export function renderSidebarTabs() {
  document.querySelectorAll(".sidebar-tab").forEach((tab) => {
    const isActive = tab.dataset.sidebarTab === state.sidebarTab;
    tab.classList.toggle("is-active", isActive);

    if (isActive) {
      tab.setAttribute("aria-current", "page");
    } else {
      tab.removeAttribute("aria-current");
    }
  });
}

/**
 * Полностью перерисовывает тело боковой панели в зависимости от активной вкладки.
 * Также управляет видимостью виджета памяти (актуален только для локального режима).
 */
export function renderSidebarBody() {
  const body = $("#sidebar-body");
  clear(body);

  if (state.sidebarTab === "records") renderRecordsSidebar(body);
  else if (state.sidebarTab === "dashboard") renderDashboardSidebar(body);
  else if (state.sidebarTab === "dates") renderDatesSidebar(body);
  else if (state.sidebarTab === "attention") renderAttentionSidebar(body);

  if (getStorageMode() === "local") {
    renderStorageWidget();
  } else {
    const widget = $("#storage-widget");
    if (widget) widget.remove();
  }
}

/**
 * Рендерит или обновляет виджет использования памяти в подвале сайдбара.
 * Использует кэширование Promise, чтобы предотвратить многократное создание
 * DOM-элементов при частых вызовах renderSidebarBody.
 */
function renderStorageWidget() {
  if (storageWidgetPromise) return storageWidgetPromise;

  storageWidgetPromise = (async () => {
    const footer = $(".sidebar-footer");
    if (!footer) {
      storageWidgetPromise = null;
      return;
    }

    let widget = footer.querySelector("#storage-widget");
    if (!widget) {
      widget = el("div", { class: "storage-widget", id: "storage-widget" });
      widget.addEventListener("click", () => openSettings());
      footer.prepend(widget);
    }

    widget.innerHTML = "";

    try {
      const stats = await getStorageStats();
      const sizeMb = (stats.estimatedSize / (1024 * 1024)).toFixed(2);
      const percent = stats.hasQuota
        ? Math.min(100, (stats.browserUsage / stats.quota) * 100)
        : 0;

      const fillClass =
        percent >= 85 ? "is-danger" : percent >= 60 ? "is-warning" : "";

      const displayValue = stats.hasQuota
        ? `${percent.toFixed(1)}%`
        : `${sizeMb} МБ`;

      widget.appendChild(
        el("div", { class: "storage-widget-header" }, [
          el("span", { class: "storage-widget-label", text: "Память" }),
          el("span", { class: "storage-widget-value", text: displayValue }),
        ]),
      );

      widget.appendChild(
        el("div", { class: "storage-widget-bar" }, [
          el("div", {
            class: `storage-widget-fill ${fillClass}`,
            style: {
              width: `${stats.hasQuota ? percent : Math.min(30, parseFloat(sizeMb))}%`,
            },
          }),
        ]),
      );
    } catch {
      widget.appendChild(
        el("span", {
          class: "storage-widget-label",
          text: "Память недоступна",
        }),
      );
    }

    storageWidgetPromise = null;
  })();

  return storageWidgetPromise;
}

/**
 * Отрисовывает разделы (Все, Сегодня, Предстоящие и т.д.) и список типов задач.
 *
 * @param {HTMLElement} container - Контейнер тела сайдбара.
 */
export function renderRecordsSidebar(container) {
  const section = el("div", { class: "side-section" });
  section.appendChild(el("div", { class: "side-title", text: "Разделы" }));

  RECORDS_VIEWS.forEach((view) => {
    const isActive = state.recordsView === view.id;

    section.appendChild(
      el(
        "button",
        {
          class: `side-item${isActive ? " is-active" : ""}`,
          onclick: () => {
            state.recordsView = view.id;
            state.statusFilter = "";
            closeTaskPanel();
            renderSidebarBody();
            renderTopbar();
            EventBus.emit("irsalio:reload");
            closeSidebar();
          },
        },
        [
          el("span", { class: "side-item-icon" }, [icon(view.icon, 16)]),
          el("span", { class: "side-item-label", text: view.label }),
        ],
      ),
    );
  });
  container.appendChild(section);

  // --- Секция типов задач ---
  const typesSection = el("div", { class: "side-section" });
  typesSection.appendChild(el("div", { class: "side-title", text: "Типы" }));

  state.types.forEach((type) => {
    const isActive = state.typeId === type.id;

    const item = el("button", {
      class: `side-item${isActive ? " is-active" : ""}`,
      onclick: () => {
        state.typeId = state.typeId === type.id ? "" : type.id;
        closeTaskPanel();
        renderSidebarBody();
        renderTopbar();
        renderTypeFilter();
        EventBus.emit("irsalio:reload");
      },
    });

    item.appendChild(
      el("span", { class: "side-item-icon" }, [
        el("span", { class: "type-dot", style: { background: type.color } }),
      ]),
    );
    item.appendChild(el("span", { class: "side-item-label", text: type.name }));

    item.appendChild(
      el("span", { class: "side-item-actions" }, [
        el(
          "button",
          {
            class: "icon-btn",
            "aria-label": `Редактировать тип ${type.name}`,
            onclick: (e) => {
              e.stopPropagation();
              openTypeEditor(type);
            },
          },
          [icon("pencil", 12)],
        ),
      ]),
    );

    typesSection.appendChild(item);
  });

  // Кнопка создания нового типа
  typesSection.appendChild(
    el(
      "button",
      {
        class: "side-item",
        onclick: () => openTypeEditor(null),
      },
      [
        el("span", { class: "side-item-icon" }, [icon("plus", 16)]),
        el("span", { class: "side-item-label", text: "Новый тип" }),
        el("span", { class: "side-item-actions-placeholder" }),
      ],
    ),
  );

  container.appendChild(typesSection);
}

/**
 * Отрисовывает описательный блок для вкладки "Дашборд".
 *
 * @param {HTMLElement} container - Контейнер тела сайдбара.
 */
export function renderDashboardSidebar(container) {
  const section = el("div", { class: "side-section" });
  section.appendChild(el("div", { class: "side-title", text: "Дашборд" }));
  section.appendChild(
    el("div", {
      class: "side-item-description",
      text: "Метрики и графики по записям текущего пространства.",
    }),
  );
  container.appendChild(section);
}

/**
 * Отрисовывает описательный блок для вкладки "Календарь".
 *
 * @param {HTMLElement} container - Контейнер тела сайдбара.
 */
export function renderDatesSidebar(container) {
  const section = el("div", { class: "side-section" });
  section.appendChild(el("div", { class: "side-title", text: "Календарь" }));
  section.appendChild(
    el("div", {
      class: "side-item-description",
      text: "Неделя, месяц и год. Свайпайте для навигации.",
    }),
  );
  container.appendChild(section);
}

/**
 * Отрисовывает список задач, требующих внимания (просроченные и скоро истекающие).
 * Клик по элементу переключает вид на соответствующий фильтр в записях.
 *
 * @param {HTMLElement} container - Контейнер тела сайдбара.
 */
export function renderAttentionSidebar(container) {
  const overdueTasks = state.tasks.filter(isTaskOverdue);
  const soonTasks = state.tasks.filter(isTaskDueSoon);

  const section = el("div", { class: "side-section" });
  section.appendChild(
    el("div", { class: "side-title", text: "Требуют внимания" }),
  );

  if (overdueTasks.length > 0) {
    section.appendChild(
      el(
        "button",
        {
          class: "side-item",
          onclick: () => {
            state.sidebarTab = "records";
            state.recordsView = "all";
            state.statusFilter = "overdue";
            closeTaskPanel();
            renderAll();
            EventBus.emit("irsalio:reload");
          },
        },
        [
          el("span", { class: "side-item-icon" }, [icon("alert", 16)]),
          el("span", { class: "side-item-label", text: "Просроченные" }),
          el("span", {
            class: "side-item-count",
            text: String(overdueTasks.length),
          }),
        ],
      ),
    );
  }

  if (soonTasks.length > 0) {
    section.appendChild(
      el(
        "button",
        {
          class: "side-item",
          onclick: () => {
            state.sidebarTab = "records";
            state.recordsView = "today";
            state.statusFilter = "";
            closeTaskPanel();
            renderAll();
            EventBus.emit("irsalio:reload");
          },
        },
        [
          el("span", { class: "side-item-icon" }, [icon("clock", 16)]),
          el("span", { class: "side-item-label", text: "Скоро истекают" }),
          el("span", {
            class: "side-item-count",
            text: String(soonTasks.length),
          }),
        ],
      ),
    );
  }

  if (overdueTasks.length === 0 && soonTasks.length === 0) {
    section.appendChild(
      el("div", { class: "side-item-description", text: "Всё под контролем." }),
    );
  }

  container.appendChild(section);
}

/**
 * Обновляет бейдж с количеством задач, требующих внимания, на вкладке "Внимание".
 * Скрывает бейдж, если таких задач нет.
 */
export function renderAttentionCount() {
  const badge = $("#attention-count");
  if (!badge) return;

  const count = state.tasks.filter(
    (t) => isTaskOverdue(t) || isTaskDueSoon(t),
  ).length;

  badge.hidden = count === 0;
  badge.textContent = String(count);
}