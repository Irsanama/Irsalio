/**
 * @file Модуль аутентификации, управления темой и загрузки данных рабочего пространства.
 * @description Отвечает за логику входа/регистрации, переключение режимов хранения,
 *              применение темы, а также за оркестрацию загрузки задач и типов
 *              при входе в приложение или смене пространства.
 */

import {
  api,
  setToken,
  clearToken,
  getStorageMode,
  switchMode,
} from "../storage/api.js";
import { $ } from "../core/dom.js";
import { toast } from "../core/ui.js";
import {
  state,
  STORAGE_KEYS,
  smartSortTasks,
  mergeTasks,
} from "../state/state.js";
import {
  ensureRuntimeStyles,
  ensureStatusFilter,
  ensureStorageBadgeInSidebar,
} from "../render/components.js";
import { renderAll } from "../app/app.js";
import { renderTypeFilter } from "../render/renderLayout.js";
import { renderSidebarBody } from "../render/renderSidebar.js";
import { renderContent } from "../render/renderContent.js";
import { renderTaskPanel } from "./taskPanel.js";


/**
 * Применяет текущую тему из глобального состояния к корневому элементу DOM.
 */
export function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
}

/**
 * Устанавливает новую тему и сохраняет выбор в localStorage.
 *
 * @param {'light'|'dark'} t - Название темы.
 */
export function setTheme(t) {
  state.theme = t;
  localStorage.setItem(STORAGE_KEYS.theme, t);
  applyTheme();
}

/**
 * Переключает тему между светлой и тёмной.
 */
export function toggleTheme() {
  setTheme(state.theme === "light" ? "dark" : "light");
}

/**
 * Показывает экран авторизации, скрывая остальные экраны.
 * Также обновляет UI переключателя режимов хранения.
 */
export function showAuth() {
  $("#boot-screen").hidden = true;
  $("#auth-screen").hidden = false;
  $("#app-screen").hidden = true;
  renderAuthModeSwitch();
}

/**
 * Показывает основное приложение, скрывая экраны загрузки и авторизации.
 */
export function showApp() {
  $("#boot-screen").hidden = true;
  $("#auth-screen").hidden = true;
  $("#app-screen").hidden = false;
}

/**
 * Отображает сообщение об ошибке на экране авторизации.
 *
 * @param {string} msg - Текст ошибки.
 */
export function showAuthError(msg) {
  const n = $("#auth-error");
  n.hidden = false;
  n.textContent = msg;
}

/**
 * Скрывает сообщение об ошибке на экране авторизации.
 */
export function hideAuthError() {
  const n = $("#auth-error");
  n.hidden = true;
  n.textContent = "";
}


/**
 * Обновляет UI переключателя режимов хранения (Локально/Сервер)
 * в зависимости от текущего активного режима.
 */
export function renderAuthModeSwitch() {
  const localBtn = $("#mode-local-btn");
  const serverBtn = $("#mode-server-btn");
  const statusEl = $("#auth-mode-status");
  const hintEl = $("#auth-mode-hint");

  if (!localBtn || !serverBtn) return;

  const currentMode = getStorageMode() || "local";
  localBtn.classList.toggle("is-active", currentMode === "local");
  serverBtn.classList.toggle("is-active", currentMode === "server");

  if (currentMode === "local") {
    statusEl.textContent = "Режим: Локальное хранение";
    hintEl.textContent =
      "Данные хранятся в этом браузере. Экспортируйте резервные копии.";
    hintEl.className = "auth-mode-hint is-warning";
  } else {
    statusEl.textContent = "Режим: Серверная БД";
    hintEl.textContent =
      "Данные синхронизируются с сервером и доступны с других устройств.";
    hintEl.className = "auth-mode-hint is-success";
  }
}

/**
 * Обработчик переключения режима хранения из HTML (inline onclick).
 * Экспортируется в window, так как вызывается из статического HTML
 * до загрузки ES-модулей (обход ограничений CSP на inline-скрипты).
 *
 * @param {'local'|'server'} mode - Целевой режим.
 */
export const __switchMode = async (mode) => {
  const localBtn = $("#mode-local-btn");
  const serverBtn = $("#mode-server-btn");
  const hintEl = $("#auth-mode-hint");

  if (localBtn) localBtn.classList.toggle("is-active", mode === "local");
  if (serverBtn) serverBtn.classList.toggle("is-active", mode === "server");

  if (hintEl) {
    hintEl.textContent = "Переключение...";
    hintEl.className = "auth-mode-hint";
  }

  await switchMode(mode);
  clearToken();
  window.location.reload();
};
window.__switchMode = __switchMode;


/**
 * Инициализирует обработчики событий для форм входа и регистрации,
 * а также для кнопок показа/скрытия пароля.
 */
export function setupAuth() {
  // Переключатели видимости пароля
  document.querySelectorAll("[data-password-toggle]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const control = btn.closest(".password-control");
      const input = control.querySelector("input");
      const isPassword = input.type === "password";

      input.type = isPassword ? "text" : "password";
      control.classList.toggle("is-visible", isPassword);
      btn.setAttribute(
        "aria-label",
        isPassword ? "Скрыть пароль" : "Показать пароль",
      );
    });
  });

  const loginTab = $("#auth-tab-login");
  const registerTab = $("#auth-tab-register");
  const loginForm = $("#login-form");
  const registerForm = $("#register-form");

  // Переключение вкладок Вход / Регистрация
  loginTab.addEventListener("click", () => {
    hideAuthError();
    loginTab.classList.add("is-active");
    loginTab.setAttribute("aria-selected", "true");
    registerTab.classList.remove("is-active");
    registerTab.setAttribute("aria-selected", "false");
    loginForm.hidden = false;
    registerForm.hidden = true;
  });

  registerTab.addEventListener("click", () => {
    hideAuthError();
    registerTab.classList.add("is-active");
    registerTab.setAttribute("aria-selected", "true");
    loginTab.classList.remove("is-active");
    loginTab.setAttribute("aria-selected", "false");
    registerForm.hidden = false;
    loginForm.hidden = true;
  });

  // Обработчик входа
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAuthError();
    const btn = loginForm.querySelector('button[type="submit"]');
    btn.classList.add("is-loading");

    try {
      const data = await api.login({
        username: $("#login-username").value.trim(),
        password: $("#login-password").value,
      });
      setToken(data.token);
      await enterApp();
    } catch (err) {
      showAuthError(err.message);
    } finally {
      btn.classList.remove("is-loading");
    }
  });

  // Обработчик регистрации
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAuthError();

    const pw = $("#register-password").value;
    const repeat = $("#register-password-repeat");

    if (repeat && pw !== repeat.value) {
      showAuthError("Пароли не совпадают");
      return;
    }

    const btn = registerForm.querySelector('button[type="submit"]');
    btn.classList.add("is-loading");

    try {
      const data = await api.register({
        username: $("#register-username").value.trim(),
        displayName: $("#register-display-name").value.trim(),
        password: pw,
      });
      setToken(data.token);
      await enterApp();
    } catch (err) {
      showAuthError(err.message);
    } finally {
      btn.classList.remove("is-loading");
    }
  });
}

/**
 * Выполняет вход в приложение: получает данные пользователя,
 * инициализирует UI и загружает данные первого доступного пространства.
 *
 * @throws {Error} Если не удалось получить данные пользователя или создать пространство.
 */
export async function enterApp() {
  const me = await api.me();
  state.user = me.user;
  state.workspaces = me.workspaces;

  if (
    !state.workspaceId ||
    !state.workspaces.some((w) => w.id === state.workspaceId)
  ) {
    state.workspaceId = state.workspaces[0]?.id || null;
  }

  // Если у пользователя нет пространств, создаём дефолтное
  if (!state.workspaceId) {
    const ws = await api.createWorkspace({ name: "Моё пространство" });
    state.workspaces.push(ws);
    state.workspaceId = ws.id;
  }

  localStorage.setItem(STORAGE_KEYS.workspaceId, state.workspaceId);

  showApp();
  ensureRuntimeStyles();
  ensureStorageBadgeInSidebar();
  ensureStatusFilter();

  try {
    await loadWorkspaceData();
  } catch (err) {
    console.error("Ошибка загрузки данных пространства:", err);
    state.tasks = [];
    state.types = [];
  }

  renderAll();
}


/**
 * Параллельно загружает типы задач и сами задачи для текущего пространства.
 *
 * @returns {Promise<void>}
 */
export async function loadWorkspaceData() {
  await Promise.all([loadTypes(), loadTasks()]);
}

/**
 * Загружает типы задач для текущего пространства и обновляет UI фильтров.
 *
 * @returns {Promise<void>}
 */
export async function loadTypes() {
  try {
    state.types = await api.types(state.workspaceId);
  } catch (err) {
    console.error("Ошибка загрузки типов:", err);
    state.types = [];
  }
  renderTypeFilter();
  renderSidebarBody();
}

/**
 * Загружает задачи с учётом текущих фильтров, сортировки и активной вкладки.
 * В случае ошибки сети показывает уведомление и очищает список задач,
 * чтобы пользователь не видел устаревшие данные.
 *
 * @returns {Promise<void>}
 */
export async function loadTasks() {
  const cp = {
    search: state.search,
    sort: state.sort,
    order: state.order,
    typeId: state.typeId,
  };

  try {
    if (state.sidebarTab === "dashboard" || state.sidebarTab === "attention") {
      const [a, d] = await Promise.all([
        api.tasks(state.workspaceId, { ...cp, view: "all" }),
        api.tasks(state.workspaceId, { ...cp, view: "done" }),
      ]);
      state.tasks = smartSortTasks(mergeTasks(a, d));
    } else if (state.sidebarTab === "dates") {
      const [a, d] = await Promise.all([
        api.tasks(state.workspaceId, {
          ...cp,
          view: "all",
          sort: "due_at",
          order: "asc",
        }),
        api.tasks(state.workspaceId, {
          ...cp,
          view: "done",
          sort: "due_at",
          order: "asc",
        }),
      ]);
      state.tasks = mergeTasks(a, d);
    } else if (state.sidebarTab === "records") {
      if (state.recordsView === "all") {
        const [a, d] = await Promise.all([
          api.tasks(state.workspaceId, { ...cp, view: "all" }),
          api.tasks(state.workspaceId, { ...cp, view: "done" }),
        ]);
        state.tasks = smartSortTasks(mergeTasks(a, d));
      } else if (state.recordsView === "today") {
        const [today, overdue] = await Promise.all([
          api.tasks(state.workspaceId, { ...cp, view: "today" }),
          api.tasks(state.workspaceId, { ...cp, view: "overdue" }),
        ]);
        state.tasks = smartSortTasks(mergeTasks(today, overdue));
      } else {
        state.tasks = await api.tasks(state.workspaceId, {
          view: state.recordsView,
          ...cp,
        });
      }
    } else {
      state.tasks = await api.tasks(state.workspaceId, { view: "all", ...cp });
    }
  } catch (err) {
    console.error("Ошибка загрузки задач:", err);
    // Показываем тост, чтобы пользователь понимал причину пустого списка
    toast("Не удалось загрузить задачи", "error");
    state.tasks = [];
  }

  renderContent();
}

/**
 * Полностью перезагружает задачи и, если открыта панель редактирования,
 * обновляет её содержимое актуальными данными.
 *
 * @returns {Promise<void>}
 */
export async function refreshTasks() {
  await loadTasks();
  if (state.editingTaskId && !$("#task-panel").hidden) {
    await renderTaskPanel();
  }
}

/**
 * Выполняет выход из аккаунта: очищает токен, ID пространства
 * и перезагружает страницу для возврата на экран авторизации.
 */
export function logout() {
  clearToken();
  localStorage.removeItem(STORAGE_KEYS.workspaceId);
  window.location.reload();
}