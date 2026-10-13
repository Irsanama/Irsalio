/**
 * @file Домен задач и подзадач для локального хранилища.
 * @description Реализует CRUD-операции для tasks и subtasks, включая фильтрацию
 *              по представлениям (view), сортировку и обогащение задач связанными
 *              данными (типы, подзадачи) для совместимости с серверным API.
 */

import {
  initLocalDb,
  getByKey,
  put,
  remove,
  getByIndex,
  getAll,
  generateId,
  enrichTask,
  STORES,
  INDEXES,
} from "./localDbCore.js";

const DEFAULT_PRIORITY = 2;
const DEFAULT_STATUS = "todo";
const DEFAULT_SORT_FIELD = "created_at";

/**
 * Проверяет корректность диапазона дат выполнения задачи.
 *
 * @param {string|null} dueAt - Начало диапазона (ISO).
 * @param {string|null} dueEndAt - Конец диапазона (ISO).
 * @throws {Error} Если диапазон невалиден.
 */
function validateDueRange(dueAt, dueEndAt) {
  if (dueEndAt && !dueAt) {
    throw new Error("Конец срока не может быть задан без начала");
  }
  if (dueEndAt && dueAt) {
    if (new Date(dueEndAt) < new Date(dueAt)) {
      throw new Error("Конец срока должен быть не раньше начала");
    }
  }
}

/**
 * Форматирует дату в строку формата YYYY-MM-DD для сравнения с due_at.
 *
 * @param {Date} date - Объект даты.
 * @returns {string} Строка в формате YYYY-MM-DD.
 */
function formatTodayStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Фильтрует задачи в соответствии с выбранным представлением (view).
 *
 * @param {Array<object>} tasks - Массив обогащённых задач.
 * @param {string} view - Идентификатор представления (all, today, upcoming и т.д.).
 * @returns {Array<object>} Отфильтрованный массив задач.
 */
function applyViewFilter(tasks, view) {
  const now = new Date();
  const todayStr = formatTodayStr(now);

  switch (view) {
    case "today":
      return tasks.filter(
        (t) => !t.deleted_at && t.due_at && t.due_at.slice(0, 10) === todayStr,
      );
    case "upcoming":
      return tasks.filter((t) => {
        if (t.deleted_at || !t.due_at) return false;
        const dueDate = new Date(t.due_at);
        return !Number.isNaN(dueDate.getTime()) && dueDate > now;
      });
    case "overdue":
      return tasks.filter((t) => {
        if (t.deleted_at || t.status === "done" || !t.due_at) return false;
        const checkDate = t.due_end_at || t.due_at;
        return new Date(checkDate) < now;
      });
    case "done":
      return tasks.filter((t) => t.status === "done");
    case "pinned":
      return tasks.filter((t) => !t.deleted_at && t.is_pinned);
    case "trash":
      return tasks.filter((t) => t.deleted_at);
    case "all":
    default:
      return tasks.filter((t) => !t.deleted_at);
  }
}

/**
 * Фильтрует задачи по типу.
 *
 * @param {Array<object>} tasks - Массив задач.
 * @param {string} typeId - Идентификатор типа (или 'none' для задач без типа).
 * @returns {Array<object>} Отфильтрованный массив.
 */
function applyTypeFilter(tasks, typeId) {
  if (!typeId) return tasks;
  if (typeId === "none") return tasks.filter((t) => !t.task_type_id);
  return tasks.filter((t) => t.task_type_id === typeId);
}

/**
 * Фильтрует задачи по поисковому запросу (название и описание).
 *
 * @param {Array<object>} tasks - Массив задач.
 * @param {string} search - Поисковая строка.
 * @returns {Array<object>} Отфильтрованный массив.
 */
function applySearchFilter(tasks, search) {
  if (!search) return tasks;
  const query = search.toLowerCase();
  return tasks.filter(
    (t) =>
      t.title.toLowerCase().includes(query) ||
      (t.description && t.description.toLowerCase().includes(query)),
  );
}

/**
 * Сортирует задачи по указанному полю и направлению.
 *
 * @param {Array<object>} tasks - Массив задач.
 * @param {string} sortField - Поле для сортировки.
 * @param {string} order - Направление ('asc' или 'desc').
 * @returns {Array<object>} Отсортированный массив (новая копия).
 */
function sortTasks(tasks, sortField, order) {
  const direction = order === "asc" ? 1 : -1;
  return [...tasks].sort((a, b) => {
    const va = a[sortField] ?? "";
    const vb = b[sortField] ?? "";
    if (typeof va === "number" && typeof vb === "number") {
      return (va - vb) * direction;
    }
    return String(va).localeCompare(String(vb)) * direction;
  });
}

/**
 * Возвращает отфильтрованный, отсортированный и обогащённый список задач.
 *
 * @param {string} workspaceId - Идентификатор рабочего пространства.
 * @param {object} [params={}] - Параметры фильтрации и сортировки.
 * @returns {Promise<Array<object>>} Список задач.
 */
export async function tasks(workspaceId, params = {}) {
  await initLocalDb();

  const rawTasks = await getByIndex(
    STORES.TASKS,
    INDEXES.TASKS_WORKSPACE_ID,
    workspaceId,
  );
  const workspaceTypes = await getByIndex(
    STORES.TYPES,
    INDEXES.TYPES_WORKSPACE_ID,
    workspaceId,
  );
  const allSubtasks = await getAll(STORES.SUBTASKS);

  const enriched = rawTasks.map((t) =>
    enrichTask(t, workspaceTypes, allSubtasks),
  );

  let filtered = applyViewFilter(enriched, params.view || "all");
  filtered = applyTypeFilter(filtered, params.typeId);
  filtered = applySearchFilter(filtered, params.search);

  return sortTasks(filtered, params.sort || DEFAULT_SORT_FIELD, params.order);
}

/**
 * Возвращает одну задачу по ID вместе с типом и подзадачами.
 *
 * @param {string} id - Идентификатор задачи.
 * @returns {Promise<object>} Обогащённая задача.
 * @throws {Error} Если задача не найдена.
 */
export async function getTask(id) {
  await initLocalDb();
  const task = await getByKey(STORES.TASKS, id);
  if (!task) throw new Error("Задача не найдена");

  const workspaceTypes = await getByIndex(
    STORES.TYPES,
    INDEXES.TYPES_WORKSPACE_ID,
    task.workspaceId,
  );
  const subtasks = await getByIndex(
    STORES.SUBTASKS,
    INDEXES.SUBTASKS_TASK_ID,
    id,
  );

  return enrichTask(task, workspaceTypes, subtasks);
}

/**
 * Создаёт новую задачу в указанном рабочем пространстве.
 *
 * @param {string} workspaceId - Идентификатор пространства.
 * @param {object} data - Данные задачи.
 * @returns {Promise<object>} Созданная и обогащённая задача.
 * @throws {Error} Если невалиден диапазон дат.
 */
export async function createTask(workspaceId, data) {
  await initLocalDb();
  const now = new Date().toISOString();
  const dueAt = data.dueAt || null;
  const dueEndAt = data.dueEndAt || null;

  validateDueRange(dueAt, dueEndAt);

  const task = {
    id: generateId(),
    workspaceId,
    title: data.title,
    description: data.description || "",
    taskTypeId: data.taskTypeId || null,
    priority: data.priority || DEFAULT_PRIORITY,
    status: data.status || DEFAULT_STATUS,
    dueAt,
    dueEndAt,
    isPinned: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await put(STORES.TASKS, task);

  const workspaceTypes = await getByIndex(
    STORES.TYPES,
    INDEXES.TYPES_WORKSPACE_ID,
    workspaceId,
  );

  return enrichTask(task, workspaceTypes, []);
}

/**
 * Обновляет существующую задачу (патч).
 *
 * @param {string} id - Идентификатор задачи.
 * @param {object} data - Поля для обновления.
 * @returns {Promise<object>} Обновлённая и обогащённая задача.
 * @throws {Error} Если задача не найдена или невалиден диапазон дат.
 */
export async function updateTask(id, data) {
  await initLocalDb();
  const task = await getByKey(STORES.TASKS, id);
  if (!task) throw new Error("Задача не найдена");

  if (data.title !== undefined) task.title = data.title;
  if (data.description !== undefined) task.description = data.description;
  if (data.taskTypeId !== undefined) task.taskTypeId = data.taskTypeId;
  if (data.priority !== undefined) task.priority = data.priority;
  if (data.status !== undefined) task.status = data.status;
  if (data.dueAt !== undefined) task.dueAt = data.dueAt;
  if (data.dueEndAt !== undefined) task.dueEndAt = data.dueEndAt;
  if (data.isPinned !== undefined) task.isPinned = data.isPinned;

  task.updatedAt = new Date().toISOString();
  validateDueRange(task.dueAt, task.dueEndAt);

  await put(STORES.TASKS, task);

  const workspaceTypes = await getByIndex(
    STORES.TYPES,
    INDEXES.TYPES_WORKSPACE_ID,
    task.workspaceId,
  );
  const subtasks = await getByIndex(
    STORES.SUBTASKS,
    INDEXES.SUBTASKS_TASK_ID,
    id,
  );

  return enrichTask(task, workspaceTypes, subtasks);
}

/**
 * Мягко удаляет задачу (перемещает в корзину, устанавливая deletedAt).
 *
 * @param {string} id - Идентификатор задачи.
 * @returns {Promise<object>} Задача со статусом удалённой.
 * @throws {Error} Если задача не найдена.
 */
export async function deleteTask(id) {
  await initLocalDb();
  const task = await getByKey(STORES.TASKS, id);
  if (!task) throw new Error("Задача не найдена");

  task.deletedAt = new Date().toISOString();
  task.updatedAt = new Date().toISOString();
  await put(STORES.TASKS, task);

  return enrichTask(task, [], []);
}

/**
 * Восстанавливает задачу из корзины (сбрасывает deletedAt).
 *
 * @param {string} id - Идентификатор задачи.
 * @returns {Promise<object>} Восстановленная задача.
 * @throws {Error} Если задача не найдена.
 */
export async function restoreTask(id) {
  await initLocalDb();
  const task = await getByKey(STORES.TASKS, id);
  if (!task) throw new Error("Задача не найдена");

  task.deletedAt = null;
  task.updatedAt = new Date().toISOString();
  await put(STORES.TASKS, task);

  return enrichTask(task, [], []);
}

/**
 * Окончательно удаляет задачу и все её подзадачи из базы данных.
 *
 * @param {string} id - Идентификатор задачи.
 * @returns {Promise<{ok: boolean}>} Результат удаления.
 */
export async function permanentDeleteTask(id) {
  await initLocalDb();
  const subtasks = await getByIndex(
    STORES.SUBTASKS,
    INDEXES.SUBTASKS_TASK_ID,
    id,
  );

  for (const sub of subtasks) {
    await remove(STORES.SUBTASKS, sub.id);
  }

  await remove(STORES.TASKS, id);
  return { ok: true };
}

/**
 * Создаёт новую подзадачу для указанной задачи.
 *
 * @param {string} taskId - Идентификатор родительской задачи.
 * @param {{ title: string }} data - Данные подзадачи.
 * @returns {Promise<object>} Созданная подзадача.
 */
export async function createSubtask(taskId, { title }) {
  await initLocalDb();
  const subtask = {
    id: generateId(),
    taskId,
    title,
    completed: false,
    createdAt: new Date().toISOString(),
  };

  await put(STORES.SUBTASKS, subtask);
  return subtask;
}

/**
 * Обновляет подзадачу (название или статус выполнения).
 *
 * @param {string} id - Идентификатор подзадачи.
 * @param {object} data - Поля для обновления.
 * @returns {Promise<object>} Обновлённая подзадача.
 * @throws {Error} Если подзадача не найдена.
 */
export async function updateSubtask(id, data) {
  await initLocalDb();
  const subtask = await getByKey(STORES.SUBTASKS, id);
  if (!subtask) throw new Error("Подзадача не найдена");

  if (data.title !== undefined) subtask.title = data.title;
  if (data.completed !== undefined) subtask.completed = data.completed;

  await put(STORES.SUBTASKS, subtask);
  return subtask;
}

/**
 * Удаляет подзадачу из базы данных.
 *
 * @param {string} id - Идентификатор подзадачи.
 * @returns {Promise<{ok: boolean}>} Результат удаления.
 */
export async function deleteSubtask(id) {
  await initLocalDb();
  await remove(STORES.SUBTASKS, id);
  return { ok: true };
}