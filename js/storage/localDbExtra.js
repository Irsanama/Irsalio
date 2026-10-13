/**
 * @file Дополнительные возможности локального хранилища.
 * @description Реализует полнотекстовый поиск, экспорт/импорт рабочих пространств,
 *              оценку использования памяти и полную очистку локальных данных.
 *              Все функции работают через примитивы из localDbCore.js.
 */

import {
  initLocalDb,
  withStore,
  getByKey,
  put,
  getByIndex,
  getAll,
  generateId,
  getCurrentUser,
  STORES,
  INDEXES,
} from "./localDbCore.js";
import { tasks as fetchTasks } from "./localDbTasks.js";

const EXPORT_VERSION = 3;
const SUPPORTED_EXPORT_VERSIONS = Object.freeze([1, 2, 3]);

/**
 * Приблизительные размеры сущностей в байтах для оценки занимаемой памяти.
 * Используются, когда Storage Estimation API недоступен.
 *
 * @type {Readonly<Record<string, number>>}
 */
const SIZE_ESTIMATES = Object.freeze({
  users: 300,
  workspaces: 200,
  types: 100,
  tasks: 500,
  subtasks: 100,
});


/**
 * Выполняет полнотекстовый поиск задач по названию и описанию.
 * Делегирует фильтрацию в localDbTasks.js для единообразия с серверным API.
 *
 * @param {string} workspaceId - Идентификатор рабочего пространства.
 * @param {string} query - Поисковый запрос.
 * @returns {Promise<Array<object>>} Список найденных задач.
 */
export async function search(workspaceId, query) {
  return fetchTasks(workspaceId, { view: "all", search: query });
}


/**
 * Экспортирует всё содержимое рабочего пространства в JSON-совместимый объект.
 * Включает пространство, типы задач, задачи и их подзадачи.
 *
 * @param {string} workspaceId - Идентификатор пространства.
 * @returns {Promise<object>} Данные для экспорта.
 * @throws {Error} Если пространство не найдено.
 */
export async function exportWorkspace(workspaceId) {
  await initLocalDb();

  const workspace = await getByKey(STORES.WORKSPACES, workspaceId);
  if (!workspace) {
    throw new Error("Пространство не найдено");
  }

  const wsTypes = await getByIndex(
    STORES.TYPES,
    INDEXES.TYPES_WORKSPACE_ID,
    workspaceId,
  );

  const wsTasks = await getByIndex(
    STORES.TASKS,
    INDEXES.TASKS_WORKSPACE_ID,
    workspaceId,
  );

  const allSubtasks = await getAll(STORES.SUBTASKS);

  // Фильтруем подзадачи только для задач этого пространства,
  // чтобы не экспортировать чужие данные при общем хранилище.
  const wsTaskIds = new Set(wsTasks.map((t) => t.id));
  const wsSubtasks = allSubtasks.filter((s) => wsTaskIds.has(s.taskId));

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    workspace,
    types: wsTypes,
    tasks: wsTasks,
    subtasks: wsSubtasks,
  };
}

/**
 * Импортирует рабочее пространство из JSON-данных.
 * Поддерживает версии 1–3, автоматически мигрирует поля между форматами.
 *
 * @param {object} data - Данные импорта (результат exportWorkspace).
 * @returns {Promise<{id: string, name: string}>} Созданное пространство.
 * @throws {Error} Если пользователь не авторизован или версия не поддерживается.
 */
export async function importWorkspace(data) {
  await initLocalDb();

  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Не авторизован");
  }

  const version = Number(data.version);
  if (
    !Number.isInteger(version) ||
    !SUPPORTED_EXPORT_VERSIONS.includes(version)
  ) {
    throw new Error("Неподдерживаемая версия экспорта");
  }

  // Создаём новое пространство с новым ID, но сохраняем имя из импорта
  const workspace = {
    ...data.workspace,
    id: generateId(),
    userId: user.id,
  };
  await put(STORES.WORKSPACES, workspace);

  // Маппинг старых ID типов на новые для корректной привязки задач
  const typeMap = {};
  for (const type of data.types || []) {
    const newId = generateId();
    typeMap[type.id] = newId;
    await put(STORES.TYPES, {
      ...type,
      id: newId,
      workspaceId: workspace.id,
    });
  }

  // Маппинг старых ID задач на новые для привязки подзадач
  const taskMap = {};
  for (const task of data.tasks || []) {
    const newId = generateId();
    taskMap[task.id] = newId;

    // Нормализация полей дат: поддержка обоих форматов (camelCase и snake_case)
    const dueAt = task.dueAt || task.due_at || null;

    // В версиях < 3 dueEndAt не поддерживается — принудительно null
    const dueEndAt =
      version >= 3 ? task.dueEndAt || task.due_end_at || null : null;

    // Валидация диапазона дат для версии 3+
    if (version >= 3 && dueEndAt) {
      if (!dueAt) {
        throw new Error("Конец срока не может быть задан без начала");
      }
      if (new Date(dueEndAt) < new Date(dueAt)) {
        throw new Error("Конец срока должен быть не раньше начала");
      }
    }

    await put(STORES.TASKS, {
      id: newId,
      workspaceId: workspace.id,
      title: task.title || "",
      description: task.description || "",
      taskTypeId: task.taskTypeId
        ? typeMap[task.taskTypeId] || null
        : task.task_type_id
          ? typeMap[task.task_type_id] || null
          : null,
      priority: task.priority || 2,
      status: task.status || "todo",
      dueAt,
      dueEndAt,
      isPinned: task.isPinned || task.is_pinned || false,
      deletedAt: task.deletedAt || task.deleted_at || null,
      createdAt: task.createdAt || task.created_at || new Date().toISOString(),
      updatedAt: task.updatedAt || task.updated_at || new Date().toISOString(),
    });
  }

  // Импорт подзадач с привязкой к новым ID задач
  for (const sub of data.subtasks || []) {
    await put(STORES.SUBTASKS, {
      ...sub,
      id: generateId(),
      taskId: taskMap[sub.taskId] || taskMap[sub.task_id] || null,
    });
  }

  return { id: workspace.id, name: workspace.name };
}


/**
 * Возвращает статистику использования локального хранилища.
 * Использует Storage Estimation API, если доступен, иначе оценивает размер по количеству сущностей.
 *
 * @returns {Promise<object>} Статистика хранилища.
 */
export async function getStorageStats() {
  await initLocalDb();

  let quota = null;
  let browserUsage = 0;

  if (navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      quota = estimate.quota || null;
      browserUsage = estimate.usage || 0;
    } catch {
    }
  }

  const counts = {
    users: 0,
    workspaces: 0,
    types: 0,
    tasks: 0,
    subtasks: 0,
  };

  const storeMapping = [
    [STORES.USERS, "users"],
    [STORES.WORKSPACES, "workspaces"],
    [STORES.TYPES, "types"],
    [STORES.TASKS, "tasks"],
    [STORES.SUBTASKS, "subtasks"],
  ];

  for (const [storeName, countKey] of storeMapping) {
    try {
      const all = await getAll(storeName);
      counts[countKey] = all.length;
    } catch {
      // Хранилище ещё не создано — оставляем 0
    }
  }

  // Приближённая оценка размера в байтах на основе количества сущностей
  const estimatedSize =
    counts.workspaces * SIZE_ESTIMATES.workspaces +
    counts.types * SIZE_ESTIMATES.types +
    counts.tasks * SIZE_ESTIMATES.tasks +
    counts.subtasks * SIZE_ESTIMATES.subtasks +
    counts.users * SIZE_ESTIMATES.users;

  return {
    quota,
    browserUsage,
    estimatedSize,
    counts,
    hasQuota: quota !== null && quota > 0,
  };
}

/**
 * Полностью очищает все данные локального хранилища.
 * Удаляет пользователей, пространства, задачи, типы, подзадачи и метаданные (токены).
 *
 * @returns {Promise<void>}
 */
export async function clearAllLocalData() {
  await initLocalDb();

  const stores = [
    STORES.USERS,
    STORES.WORKSPACES,
    STORES.TYPES,
    STORES.TASKS,
    STORES.SUBTASKS,
    STORES.META,
  ];

  for (const storeName of stores) {
    try {
      await withStore(storeName, "readwrite", (store) => store.clear());
    } catch {
      // Игнорируем ошибку для отсутствующих сторов (например, если БД ещё не инициализирована)
    }
  }
}