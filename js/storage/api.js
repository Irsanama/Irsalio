/**
 * @file Фасад хранилища данных и HTTP-клиент для серверного API.
 * @description Обеспечивает  переключение между серверным режимом (REST API) и локальным
 *              режимом (IndexedDB). Все вызовы бизнес-логики идут через единый
 *              объект `api`, который динамически возвращает методы активного бэкенда.
 *              Также содержит критическое исправление: `cache: "no-store"` в `fetch`,
 *              предотвращающее возврат закэшированных GET-запросов браузером.
 */

import { localDb, initLocalDb } from "./localDb.js";
import { STORAGE_KEYS } from "../state/state.js";

const HEALTH_CHECK_TIMEOUT_MS = 2000;
const MANUAL_MODE_KEY = "irsalio_mode_manual";

let currentMode = null;


/**
 * Определяет активный режим хранения данных.
 * Приоритет выбора:
 * 1. Протокол `file://` — принудительно локальный режим (сервер недоступен).
 * 2. Ручная настройка пользователя (если сохранена в localStorage).
 * 3. Проверка доступности сервера через `/api/health`.
 *
 * @returns {Promise<'server'|'local'>} Активный режим.
 */
async function detectMode() {
  if (window.location.protocol === "file:") {
    console.log("[Irsalio] Протокол file:// — принудительный локальный режим");
    return "local";
  }

  const savedMode = localStorage.getItem(STORAGE_KEYS.mode);
  const isManual = localStorage.getItem(MANUAL_MODE_KEY) === "1";

  if (isManual && (savedMode === "server" || savedMode === "local")) {
    return savedMode;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      HEALTH_CHECK_TIMEOUT_MS,
    );

    // `cache: "no-store"` гарантирует, что браузер не вернёт закэшированный ответ,
    // если сервер временно недоступен, а мы проверяем его статус.
    const response = await fetch("/api/health", {
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(timeout);
    if (response.ok) return "server";
  } catch {
    // Сервер недоступен или таймаут — переключаемся в локальный режим
  }

  return "local";
}

/**
 * Инициализирует хранилище, определяя режим и подготавливая IndexedDB (если нужно).
 * Вызывается один раз при старте приложения.
 *
 * @returns {Promise<'server'|'local'>} Активный режим.
 */
export async function initStorage() {
  currentMode = await detectMode();
  localStorage.setItem(STORAGE_KEYS.mode, currentMode);

  if (currentMode === "local") {
    await initLocalDb();
  }

  console.log(
    `[Irsalio] Режим хранилища: ${currentMode === "server" ? "серверная БД" : "локальная IndexedDB"}`,
  );
  return currentMode;
}

/**
 * Возвращает текущий активный режим хранения.
 *
 * @returns {'server'|'local'|null}
 */
export function getStorageMode() {
  return currentMode;
}

/**
 * Принудительно устанавливает режим хранения (используется при отладке).
 *
 * @param {'server'|'local'} mode - Режим для установки.
 */
export function forceMode(mode) {
  currentMode = mode;
  localStorage.setItem(STORAGE_KEYS.mode, mode);
}

/**
 * Переключает режим хранения с очисткой текущей сессии.
 * При переключении токены и ID рабочего пространства сбрасываются.
 *
 * @param {'server'|'local'} newMode - Новый режим.
 * @returns {Promise<'server'|'local'|undefined>}
 */
export async function switchMode(newMode) {
  if (newMode !== "server" && newMode !== "local") return;

  if (newMode === "local") {
    await initLocalDb();
  }

  clearToken();
  localStorage.removeItem(STORAGE_KEYS.workspaceId);

  currentMode = newMode;
  localStorage.setItem(STORAGE_KEYS.mode, newMode);
  localStorage.setItem(MANUAL_MODE_KEY, "1");

  return newMode;
}

/**
 * Возвращает статистику использования хранилища.
 * Для серверного режима возвращает заглушку, для локального — реальные данные из IndexedDB.
 *
 * @returns {Promise<object>}
 */
export async function getStorageStats() {
  if (currentMode === "local") {
    return localDb.getStorageStats();
  }

  return {
    mode: "server",
    quota: null,
    browserUsage: 0,
    estimatedSize: 0,
    counts: { users: 0, workspaces: 0, types: 0, tasks: 0, subtasks: 0 },
    hasQuota: false,
  };
}

/**
 * Полностью очищает локальные данные (IndexedDB и токены).
 *
 * @returns {Promise<void>}
 */
export async function clearLocalData() {
  if (currentMode === "local") {
    await localDb.clearAllLocalData();
  }
  clearToken();
  localStorage.removeItem(STORAGE_KEYS.workspaceId);
}


/**
 * Маппинг полей сортировки: фронтенд (snake_case) → бэкенд (ключи ALLOWED_SORT_FIELDS).
 * Фронтенд использует snake_case для единообразия с БД, бэкенд ожидает специфичные ключи.
 *
 * @type {Readonly<Record<string, string>>}
 */
const SORT_FIELD_MAP = Object.freeze({
  created_at: "created",
  due_at: "due",
  priority: "priority",
});

/**
 * Выполняет HTTP-запрос к серверному API.
 * Автоматически добавляет токен авторизации, обрабатывает query-параметры и ошибки.
 *
 * @param {string} path - Путь относительно `/api` (например, `/workspaces/123/tasks`).
 * @param {object} [options={}] - Опции запроса.
 * @param {string} [options.method='GET'] - HTTP-метод.
 * @param {object} [options.body] - Тело запроса (будет сериализовано в JSON).
 * @param {object} [options.params] - Query-параметры.
 * @returns {Promise<any>} Данные из ответа сервера.
 * @throws {Error} Если статус ответа не 2xx или произошла сетевая ошибка.
 */
async function serverRequest(path, options = {}) {
  const { method = "GET", body, params } = options;
  let url = `/api${path}`;

  if (params) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      search.append(key, value);
    }
    const query = search.toString();
    if (query) url += `?${query}`;
  }

  const headers = {};
  const token = localStorage.getItem(STORAGE_KEYS.token) || "";

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(data?.error?.message || "Ошибка запроса");
    error.status = response.status;
    error.code = data?.error?.code;
    throw error;
  }

  return data;
}

/**
 * Объект с методами серверного API.
 * Каждый метод инкапсулирует путь и HTTP-метод.
 *
 * @type {Readonly<Record<string, Function>>}
 */
const serverApi = Object.freeze({
  register: (body) => serverRequest("/auth/register", { method: "POST", body }),
  login: (body) => serverRequest("/auth/login", { method: "POST", body }),
  me: () => serverRequest("/me"),
  updateProfile: (body) =>
    serverRequest("/me/profile", { method: "PATCH", body }),
  changePassword: (body) =>
    serverRequest("/me/password", { method: "PATCH", body }),

  createWorkspace: (body) =>
    serverRequest("/workspaces", { method: "POST", body }),
  updateWorkspace: (id, body) =>
    serverRequest(`/workspaces/${id}`, { method: "PATCH", body }),
  deleteWorkspace: (id) =>
    serverRequest(`/workspaces/${id}`, { method: "DELETE" }),

  types: (wsId) => serverRequest(`/workspaces/${wsId}/types`),
  createType: (wsId, body) =>
    serverRequest(`/workspaces/${wsId}/types`, { method: "POST", body }),
  updateType: (id, body) =>
    serverRequest(`/types/${id}`, { method: "PATCH", body }),
  deleteType: (id) => serverRequest(`/types/${id}`, { method: "DELETE" }),

  tasks: (wsId, params) => {
    const mapped = { ...params };
    if (mapped.sort && SORT_FIELD_MAP[mapped.sort]) {
      mapped.sort = SORT_FIELD_MAP[mapped.sort];
    }
    return serverRequest(`/workspaces/${wsId}/tasks`, { params: mapped });
  },
  getTask: (id) => serverRequest(`/tasks/${id}`),
  createTask: (wsId, body) =>
    serverRequest(`/workspaces/${wsId}/tasks`, { method: "POST", body }),
  updateTask: (id, body) =>
    serverRequest(`/tasks/${id}`, { method: "PATCH", body }),
  deleteTask: (id) => serverRequest(`/tasks/${id}`, { method: "DELETE" }),
  restoreTask: (id) =>
    serverRequest(`/tasks/${id}/restore`, { method: "POST" }),
  permanentDeleteTask: (id) =>
    serverRequest(`/tasks/${id}/permanent`, { method: "DELETE" }),

  createSubtask: (taskId, body) =>
    serverRequest(`/tasks/${taskId}/subtasks`, { method: "POST", body }),
  updateSubtask: (id, body) =>
    serverRequest(`/subtasks/${id}`, { method: "PATCH", body }),
  deleteSubtask: (id) => serverRequest(`/subtasks/${id}`, { method: "DELETE" }),

  search: (wsId, q) =>
    serverRequest(`/workspaces/${wsId}/search`, { params: { q } }),
  exportWorkspace: (id) => serverRequest(`/workspaces/${id}/export`),
  importWorkspace: (body) =>
    serverRequest("/workspaces/import", { method: "POST", body }),
});

/**
 * Возвращает активный бэкенд (серверный API или локальную IndexedDB).
 *
 * @returns {object}
 */
function getBackend() {
  return currentMode === "server" ? serverApi : localDb;
}

/**
 * Единый фасад API.
 * Использует геттеры, чтобы всегда возвращать актуальный метод
 * из текущего бэкенда (на случай динамического переключения режима).
 *
 * @type {Readonly<Record<string, Function>>}
 */
export const api = Object.freeze({
  get register() {
    return getBackend().register;
  },
  get login() {
    return getBackend().login;
  },
  get me() {
    return getBackend().me;
  },
  get updateProfile() {
    return getBackend().updateProfile;
  },
  get changePassword() {
    return getBackend().changePassword;
  },

  get createWorkspace() {
    return getBackend().createWorkspace;
  },
  get updateWorkspace() {
    return getBackend().updateWorkspace;
  },
  get deleteWorkspace() {
    return getBackend().deleteWorkspace;
  },

  get types() {
    return getBackend().types;
  },
  get createType() {
    return getBackend().createType;
  },
  get updateType() {
    return getBackend().updateType;
  },
  get deleteType() {
    return getBackend().deleteType;
  },

  get tasks() {
    return getBackend().tasks;
  },
  get getTask() {
    return getBackend().getTask;
  },
  get createTask() {
    return getBackend().createTask;
  },
  get updateTask() {
    return getBackend().updateTask;
  },
  get deleteTask() {
    return getBackend().deleteTask;
  },
  get restoreTask() {
    return getBackend().restoreTask;
  },
  get permanentDeleteTask() {
    return getBackend().permanentDeleteTask;
  },

  get createSubtask() {
    return getBackend().createSubtask;
  },
  get updateSubtask() {
    return getBackend().updateSubtask;
  },
  get deleteSubtask() {
    return getBackend().deleteSubtask;
  },

  get search() {
    return getBackend().search;
  },
  get exportWorkspace() {
    return getBackend().exportWorkspace;
  },
  get importWorkspace() {
    return getBackend().importWorkspace;
  },
});


/**
 * Возвращает текущий JWT-токен из localStorage.
 *
 * @returns {string}
 */
export function getToken() {
  return localStorage.getItem(STORAGE_KEYS.token) || "";
}

/**
 * Сохраняет JWT-токен в localStorage.
 *
 * @param {string} token - Токен для сохранения.
 */
export function setToken(token) {
  localStorage.setItem(STORAGE_KEYS.token, token);
}

/**
 * Удаляет JWT-токен из localStorage.
 */
export function clearToken() {
  localStorage.removeItem(STORAGE_KEYS.token);
}