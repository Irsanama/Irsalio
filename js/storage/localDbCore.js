/**
 * @file Ядро локального хранилища IndexedDB.
 * @description Инициализация базы данных, создание схемы, примитивы CRUD,
 *              работа с токенами и общие утилиты для локального режима.
 *              Все остальные модули localDb* используют эти примитивы.
 */

const DB_NAME = "irsalio_db";
const DB_VERSION = 1;

/**
 * Названия object store в IndexedDB.
 * @enum {string}
 */
export const STORES = Object.freeze({
  USERS: "users",
  WORKSPACES: "workspaces",
  TYPES: "task_types",
  TASKS: "tasks",
  SUBTASKS: "subtasks",
  META: "meta",
});

/**
 * Названия индексов внутри object store.
 * @enum {string}
 */
export const INDEXES = Object.freeze({
  USERS_USERNAME: "username",
  WORKSPACES_USER_ID: "userId",
  TYPES_WORKSPACE_ID: "workspaceId",
  TASKS_WORKSPACE_ID: "workspaceId",
  TASKS_STATUS: "status",
  TASKS_DUE_AT: "dueAt",
  TASKS_DELETED_AT: "deletedAt",
  SUBTASKS_TASK_ID: "taskId",
});

const TOKEN_KEY_PREFIX = "token:";
const TOKEN_STORAGE_KEY = "irsalio_token";

let dbPromise = null;


/**
 * Инициализирует подключение к IndexedDB.
 * Повторные вызовы возвращают тот же Promise, предотвращая дублирование соединений.
 *
 * @returns {Promise<IDBDatabase>} Объект базы данных.
 * @throws {Error} Если IndexedDB не поддерживается или таймаут инициализации.
 */
export function initLocalDb() {
  if (dbPromise) return dbPromise;

  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB не поддерживается в этом браузере или режиме");
  }

  dbPromise = new Promise((resolve, reject) => {
    let settled = false;

    // Защита от зависания, если onsuccess/onerror не срабатывают
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Таймаут инициализации IndexedDB"));
      }
    }, 2500);

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn(value);
    };

    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        initDatabaseSchema(event.target.result);
      };

      request.onsuccess = (event) => settle(resolve, event.target.result);
      request.onerror = (event) =>
        settle(
          reject,
          event.target.error || new Error("Ошибка открытия IndexedDB"),
        );
    } catch (err) {
      settle(reject, err);
    }
  });

  return dbPromise;
}

/**
 * Создаёт схему базы данных: object store и индексы.
 * Вызывается автоматически при onupgradeneeded.
 *
 * @param {IDBDatabase} database - Объект базы данных.
 */
function initDatabaseSchema(database) {
  if (!database.objectStoreNames.contains(STORES.USERS)) {
    const store = database.createObjectStore(STORES.USERS, { keyPath: "id" });
    store.createIndex(INDEXES.USERS_USERNAME, "username", { unique: true });
  }

  if (!database.objectStoreNames.contains(STORES.WORKSPACES)) {
    const store = database.createObjectStore(STORES.WORKSPACES, {
      keyPath: "id",
    });
    store.createIndex(INDEXES.WORKSPACES_USER_ID, "userId");
  }

  if (!database.objectStoreNames.contains(STORES.TYPES)) {
    const store = database.createObjectStore(STORES.TYPES, { keyPath: "id" });
    store.createIndex(INDEXES.TYPES_WORKSPACE_ID, "workspaceId");
  }

  if (!database.objectStoreNames.contains(STORES.TASKS)) {
    const store = database.createObjectStore(STORES.TASKS, { keyPath: "id" });
    store.createIndex(INDEXES.TASKS_WORKSPACE_ID, "workspaceId");
    store.createIndex(INDEXES.TASKS_STATUS, "status");
    store.createIndex(INDEXES.TASKS_DUE_AT, "dueAt");
    store.createIndex(INDEXES.TASKS_DELETED_AT, "deletedAt");
  }

  if (!database.objectStoreNames.contains(STORES.SUBTASKS)) {
    const store = database.createObjectStore(STORES.SUBTASKS, {
      keyPath: "id",
    });
    store.createIndex(INDEXES.SUBTASKS_TASK_ID, "taskId");
  }

  if (!database.objectStoreNames.contains(STORES.META)) {
    database.createObjectStore(STORES.META, { keyPath: "key" });
  }
}


/**
 * Выполняет операцию внутри транзакции IndexedDB.
 * Базовый примитив, на котором строятся все остальные CRUD-методы.
 *
 * @param {string} storeName - Имя object store.
 * @param {'readonly'|'readwrite'} mode - Режим транзакции.
 * @param {function(IDBObjectStore): IDBRequest} callback - Функция, выполняющая запрос.
 * @returns {Promise<any>} Результат запроса.
 */
export async function withStore(storeName, mode, callback) {
  const db = await initLocalDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = callback(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Возвращает все записи из указанного store.
 *
 * @param {string} storeName - Имя store.
 * @returns {Promise<Array<object>>} Массив записей.
 */
export function getAll(storeName) {
  return withStore(storeName, "readonly", (store) => store.getAll());
}

/**
 * Возвращает запись по её первичному ключу.
 *
 * @param {string} storeName - Имя store.
 * @param {string} key - Первичный ключ.
 * @returns {Promise<object|undefined>} Запись или undefined.
 */
export function getByKey(storeName, key) {
  return withStore(storeName, "readonly", (store) => store.get(key));
}

/**
 * Сохраняет или обновляет запись в store.
 *
 * @param {string} storeName - Имя store.
 * @param {object} data - Данные для сохранения (должны содержать ключ).
 * @returns {Promise<string>} Ключ сохранённой записи.
 */
export function put(storeName, data) {
  return withStore(storeName, "readwrite", (store) => store.put(data));
}

/**
 * Удаляет запись из store по ключу.
 *
 * @param {string} storeName - Имя store.
 * @param {string} key - Первичный ключ.
 * @returns {Promise<void>}
 */
export function remove(storeName, key) {
  return withStore(storeName, "readwrite", (store) => store.delete(key));
}

/**
 * Возвращает все записи, соответствующие значению индекса.
 *
 * @param {string} storeName - Имя store.
 * @param {string} indexName - Имя индекса.
 * @param {any} value - Значение для поиска.
 * @returns {Promise<Array<object>>} Массив найденных записей.
 */
export function getByIndex(storeName, indexName, value) {
  return withStore(storeName, "readonly", (store) =>
    store.index(indexName).getAll(value),
  );
}


/**
 * Генерирует уникальный идентификатор (UUID v4).
 *
 * @returns {string} UUID.
 */
export function generateId() {
  return crypto.randomUUID();
}

/**
 * Хэширует пароль с использованием SHA-256.
 * Используется только в локальном режиме (на сервере применяется scrypt).
 *
 * @param {string} password - Пароль в открытом виде.
 * @returns {Promise<string>} HEX-строка хэша.
 */
export async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Возвращает текущий токен из localStorage.
 *
 * @returns {string} Токен или пустая строка.
 */
export function getToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY) || "";
}

/**
 * Сохраняет токен в localStorage.
 *
 * @param {string} token - Токен для сохранения.
 */
export function setToken(token) {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

/**
 * Удаляет токен из localStorage.
 */
export function clearToken() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

/**
 * Возвращает объект текущего авторизованного пользователя.
 * Токен хранится в localStorage, связь токен → userId — в store META.
 *
 * @returns {Promise<object|null>} Пользователь или null, если не авторизован.
 */
export async function getCurrentUser() {
  const token = getToken();
  if (!token) return null;

  const meta = await getByKey(STORES.META, TOKEN_KEY_PREFIX + token);
  if (!meta) return null;

  return getByKey(STORES.USERS, meta.userId);
}

/**
 * Обогащает объект задачи связанными данными: типом и подзадачами.
 * Приводит поля к snake_case для полной совместимости с серверным API,
 * что позволяет использовать единые функции рендеринга для обоих режимов.
 *
 * @param {object} task - Сырая задача из IndexedDB (в camelCase).
 * @param {Array<object>} types - Все типы задач пространства.
 * @param {Array<object>} subtasks - Все подзадачи (будут отфильтрованы по taskId).
 * @returns {object} Задача в формате серверного API.
 */
export function enrichTask(task, types, subtasks) {
  const type = types.find((t) => t.id === task.taskTypeId);
  const taskSubtasks = subtasks.filter((s) => s.taskId === task.id);
  const completedCount = taskSubtasks.filter((s) => s.completed).length;

  return {
    ...task,
    task_type_id: task.taskTypeId || null,
    type_name: type?.name || null,
    type_color: type?.color || null,
    due_at: task.dueAt || null,
    due_end_at: task.dueEndAt || null,
    deleted_at: task.deletedAt || null,
    is_pinned: task.isPinned || false,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    subtasks: taskSubtasks,
    subtasks_total: taskSubtasks.length,
    subtasks_completed: completedCount,
  };
}