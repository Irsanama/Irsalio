/**
 * @file Обработчики событий, горячие клавиши, свайпы и точка входа (boot).
 * @description Отвечает за связывание DOM-элементов с логикой,
 *              глобальные горячие клавиши (Ctrl+K, N, C, E), свайпы календаря
 *              и инициализацию приложения при загрузке страницы.
 */

import { $, debounce } from "../core/dom.js";
import { toast, confirmDialog } from "../core/ui.js";
import { state, isEditableTarget } from "../state/state.js";
import { api, initStorage, getToken, clearToken } from "../storage/api.js";
import {
  applyTheme,
  toggleTheme,
  showAuth,
  enterApp,
  loadTasks,
  refreshTasks,
  setupAuth,
  logout,
} from "../features/auth.js";
import { renderAll } from "./app.js";
import {
  ensureRuntimeStyles,
  ensureStatusFilter,
} from "../render/components.js";
import { renderSidebarBody } from "../render/renderSidebar.js";
import { renderTopbar } from "../render/renderLayout.js";
import { renderContent } from "../render/renderContent.js";
import { navigateCalendar } from "../render/renderCalendar.js";
import { openTaskPanel, closeTaskPanel } from "../features/taskPanel.js";
import {
  openSettings,
  openPalette,
  openWorkspaceSwitcher,
  openSidebar,
  closeSidebar,
} from "../features/modals.js";
import { EventBus } from "../core/events.js";

const SWIPE_THRESHOLD_PX = 40;
const SWIPE_VERTICAL_TOLERANCE_PX = 100;
const RESIZE_DEBOUNCE_MS = 200;

/**
 * Маппинг горячих клавиш с учётом раскладки.
 * Ключ — физическая клавиша (event.code), значение — массив возможных event.key.
 */
const HOTKEY_LAYOUT_MAP = Object.freeze({
  KeyK: ["k", "к", "л"],
  KeyN: ["n", "т"],
  KeyC: ["c", "с"],
  KeyE: ["e", "у"],
});

const STATUS_CYCLE_ORDER = Object.freeze(["todo", "in_progress", "done"]);


/**
 * Делегирует клики по карточкам задач (смена статуса, приоритета, удаление).
 * Использует делегирование событий на контейнере #content для производительности.
 */
function setupContentEvents() {
  const content = $("#content");
  if (!content) return;

  content.addEventListener("click", async (e) => {
    const actionElement = e.target.closest("[data-action]");
    if (!actionElement) return;

    e.stopPropagation();
    const action = actionElement.dataset.action;
    const taskId = actionElement.dataset.id;
    const task = state.tasks.find((t) => t.id === taskId);

    if (!task) return;
    // Для удалённых задач разрешены только restore и permanent-delete
    if (
      task.deleted_at &&
      action !== "restore" &&
      action !== "permanent-delete"
    ) {
      return;
    }

    try {
      switch (action) {
        case "pin":
          await api.updateTask(task.id, { isPinned: !task.is_pinned });
          break;
        case "delete": {
          const okDelete = await confirmDialog({
            title: "Отправить в корзину?",
            message: `«${task.title}» будет перемещена в корзину.`,
            confirmText: "В корзину",
            danger: true,
          });
          if (okDelete) await api.deleteTask(task.id);
          break;
        }
        case "restore":
          await api.restoreTask(task.id);
          toast("Запись возвращена", "success");
          break;
        case "permanent-delete": {
          const okPermDelete = await confirmDialog({
            title: "Удалить навсегда?",
            message: "Это действие нельзя отменить.",
            confirmText: "Удалить навсегда",
            danger: true,
          });
          if (okPermDelete) await api.permanentDeleteTask(task.id);
          break;
        }
        case "cycle-status": {
          const currentIdx = STATUS_CYCLE_ORDER.indexOf(task.status);
          const nextStatus =
            STATUS_CYCLE_ORDER[(currentIdx + 1) % STATUS_CYCLE_ORDER.length];
          await api.updateTask(task.id, { status: nextStatus });
          break;
        }
        case "cycle-priority": {
          const nextPriority = task.priority >= 4 ? 1 : task.priority + 1;
          await api.updateTask(task.id, { priority: nextPriority });
          break;
        }
        default:
          return;
      }
      await refreshTasks();
    } catch (err) {
      toast(err.message || "Ошибка действия", "error");
    }
  });
}


/**
 * Проверяет, соответствует ли событие нажатой клавише ожидаемому коду и символу.
 * Учитывает физические коды клавиш (event.code), чтобы работать независимо от раскладки.
 *
 * @param {KeyboardEvent} event
 * @param {string} physicalCode - Физический код клавиши (например, 'KeyK').
 * @param {Array<string>} possibleKeys - Допустимые символы (event.key) для разных раскладок.
 * @returns {boolean}
 */
function isKeyMatch(event, physicalCode, possibleKeys) {
  if (event.code === physicalCode) return true;
  return possibleKeys.includes(String(event.key || "").toLowerCase());
}

/**
 * Проверяет комбинацию для открытия Command Palette (Ctrl/Cmd+K или Alt+K).
 *
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
function isPaletteCombo(event) {
  const ctrlOrMeta = event.ctrlKey || event.metaKey;
  const isK = isKeyMatch(event, "KeyK", HOTKEY_LAYOUT_MAP.KeyK);

  return (
    (ctrlOrMeta && isK) ||
    (ctrlOrMeta && event.code === "Space") ||
    (event.altKey && !event.ctrlKey && !event.metaKey && isK)
  );
}

/**
 * Регистрирует глобальные обработчики горячих клавиш.
 * Блокирует срабатывание, если фокус в поле ввода или открыта модалка.
 */
function setupHotkeys() {
  const onKeyDown = (event) => {
    // Игнорируем, если приложение не активно
    if ($("#app-screen").hidden || event.isComposing) return;

    const paletteOpen = Boolean($(".palette-overlay"));
    const modalOpen = Boolean($(".modal-overlay"));

    // Открытие палитры команд
    if (isPaletteCombo(event)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (!paletteOpen) openPalette();
      return;
    }

    // Закрытие панели задач или сайдбара по Escape
    if (event.key === "Escape") {
      if (!modalOpen && !paletteOpen && !$("#task-panel").hidden) {
        if (state.panelMode === "view") closeTaskPanel();
      }
      closeSidebar();
      return;
    }

    // Блокируем остальные хоткеи, если открыта модалка, палитра или фокус в инпуте
    if (
      paletteOpen ||
      modalOpen ||
      isEditableTarget(event) ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return;
    }

    // N — Новая запись
    if (isKeyMatch(event, "KeyN", HOTKEY_LAYOUT_MAP.KeyN)) {
      event.preventDefault();
      openTaskPanel(null, "edit");
      return;
    }

    // C — Календарь
    if (isKeyMatch(event, "KeyC", HOTKEY_LAYOUT_MAP.KeyC)) {
      event.preventDefault();
      state.sidebarTab = "dates";
      renderAll();
      loadTasks();
      return;
    }

    // E — Настройки
    if (isKeyMatch(event, "KeyE", HOTKEY_LAYOUT_MAP.KeyE)) {
      event.preventDefault();
      openSettings();
    }
  };

  // Используем capture phase (true), чтобы перехватить события до их остановки другими обработчиками
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener(
    "keypress",
    (event) => {
      if (isPaletteCombo(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
}


/**
 * Регистрирует обработчики свайпов для навигации по календарю на мобильных устройствах.
 * Игнорирует свайпы, если начаты на блоке задачи (чтобы не конфликтовать с Drag-and-Drop).
 */
function setupCalendarSwipe() {
  let touchStartX = 0;
  let touchStartY = 0;
  let activeCalendar = null;

  const handleTouchStart = (e) => {
    const calendar = e.target.closest(".calendar");
    if (!calendar || e.target.closest(".week-task-block")) return;

    activeCalendar = calendar;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  };

  const handleTouchEnd = (e) => {
    if (!activeCalendar) return;
    activeCalendar = null;

    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const dx = endX - touchStartX;
    const dy = endY - touchStartY;

    // Свайп засчитывается только если горизонтальное движение значительно больше вертикального
    if (
      Math.abs(dx) > SWIPE_THRESHOLD_PX &&
      Math.abs(dy) < SWIPE_VERTICAL_TOLERANCE_PX
    ) {
      navigateCalendar(dx > 0 ? -1 : 1);
    }
  };

  document.addEventListener("touchstart", handleTouchStart, { passive: true });
  document.addEventListener("touchend", handleTouchEnd, { passive: true });
}


/**
 * Привязывает обработчики к статическим элементам интерфейса:
 * сайдбар, фильтры, сортировка, переключатели тем и воркспейсов.
 */
function setupAppEvents() {
  // Сайдбар
  $("#sidebar-open")?.addEventListener("click", openSidebar);
  $("#sidebar-close")?.addEventListener("click", closeSidebar);
  $("#sidebar-backdrop")?.addEventListener("click", closeSidebar);

  // Воркспейс и создание задач
  $("#workspace-button")?.addEventListener("click", openWorkspaceSwitcher);
  $("#new-record-button")?.addEventListener("click", () =>
    openTaskPanel(null, "edit"),
  );
  $("#mobile-create")?.addEventListener("click", () =>
    openTaskPanel(null, "edit"),
  );

  // Панель задач (закрытие по клику на бэкдроп)
  const panelBackdrop = $("#task-panel-backdrop");
  if (panelBackdrop) {
    panelBackdrop.addEventListener("click", () => {
      if (state.panelMode === "view") closeTaskPanel();
    });
  }

  // Вкладки сайдбара
  document.querySelectorAll(".sidebar-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.sidebarTab = tab.dataset.sidebarTab;
      closeTaskPanel();
      renderAll();
      loadTasks();
      closeSidebar();
    });
  });

  // Глобальные действия (тема, настройки, выход, поиск)
  $("#theme-toggle")?.addEventListener("click", toggleTheme);
  $("#settings-button")?.addEventListener("click", openSettings);
  $("#logout-button")?.addEventListener("click", logout);
  $("#search-button")?.addEventListener("click", () => openPalette());

  // Фильтры и сортировка
  ensureStatusFilter();

  const statusFilter = $("#status-filter-select");
  if (statusFilter) {
    statusFilter.addEventListener("change", (e) => {
      state.statusFilter = e.target.value;
      renderTopbar();
      renderContent();
    });
  }

  $("#sort-select")?.addEventListener("change", (e) => {
    state.sort = e.target.value;
    loadTasks();
    renderTopbar();
  });

  $("#order-button")?.addEventListener("click", () => {
    state.order = state.order === "asc" ? "desc" : "asc";
    renderTopbar();
    loadTasks();
  });

  $("#type-filter-select")?.addEventListener("change", (e) => {
    state.typeId = e.target.value;
    renderSidebarBody();
    renderTopbar();
    loadTasks();
  });

  // Свайпы, хоткеи и делегирование кликов
  setupCalendarSwipe();
  setupHotkeys();
  setupContentEvents();

  // Адаптивный перерендер календаря при изменении размера окна
  window.addEventListener(
    "resize",
    debounce(() => {
      if (state.sidebarTab === "dates" && !$("#app-screen").hidden) {
        renderContent();
      }
    }, RESIZE_DEBOUNCE_MS),
  );

  // Глобальная шина событий для принудительного обновления данных
  EventBus.on("irsalio:reload", () => {
    loadTasks();
  });
}


/**
 * Инициализирует приложение: определяет режим хранения, применяет тему,
 * настраивает обработчики событий и пытается авторизовать пользователя.
 * При критической ошибке показывает экран авторизации с сообщением.
 *
 * @returns {Promise<void>}
 */
export async function boot() {
  try {
    applyTheme();
    ensureRuntimeStyles();

    // Попытка инициализировать хранилище (серверное или локальное)
    try {
      await initStorage();
    } catch (err) {
      console.error("Ошибка инициализации хранилища:", err);

      // Fallback: принудительный переход в локальный режим
      try {
        localStorage.setItem("irsalio_mode", "local");
        const localMod = await import("../storage/localDb.js");
        await localMod.initLocalDb();
      } catch (localErr) {
        console.error(
          "Не удалось инициализировать локальное хранилище:",
          localErr,
        );
        const bootCard = document.querySelector(".boot-card");
        if (bootCard) {
          bootCard.innerHTML = `
            <div class="brand-mark">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
              </svg>
            </div>
            <h1 class="boot-name" style="color: var(--danger);">Ошибка</h1>
            <p class="boot-note">Не удалось инициализировать хранилище.<br>Попробуйте другой браузер или запустите сервер.</p>
          `;
        }
        return;
      }
    }

    setupAuth();
    setupAppEvents();

    // Если токена нет — показываем экран авторизации
    if (!getToken()) {
      showAuth();
      return;
    }

    // Попытка автоматически войти по сохранённому токену
    try {
      await enterApp();
    } catch (err) {
      console.error("Ошибка входа по токену:", err);
      clearToken();
      showAuth();
    }
  } catch (err) {
    console.error("Критическая ошибка boot:", err);
    showAuth();
  }
}