/**
 * @file Домен рабочих пространств и типов задач для локального хранилища.
 * @description Реализует CRUD-операции для workspaces и task_types.
 *              При создании пространства автоматически засеивает базовые типы задач.
 */

import {
  getByKey,
  put,
  remove,
  getByIndex,
  generateId,
  getCurrentUser,
  STORES,
  INDEXES,
} from "./localDbCore.js";

const DEFAULT_TYPE_COLOR = "#6F6A63";

/**
 * Базовые типы задач, создаваемые при инициализации нового пространства.
 * Заморожены для предотвращения случайных мутаций.
 *
 * @type {ReadonlyArray<{name: string, color: string}>}
 */
const DEFAULT_TASK_TYPES = Object.freeze([
  { name: "Работа", color: "#2563EB" },
  { name: "Дом", color: "#16A34A" },
  { name: "Встречи", color: "#D97706" },
  { name: "Личное", color: "#7C3AED" },
]);

/**
 * Создаёт новое рабочее пространство и засеивает его базовыми типами задач.
 *
 * @param {{ name: string }} params - Параметры создания.
 * @returns {Promise<{ id: string, name: string }>} Созданное пространство.
 * @throws {Error} Если пользователь не авторизован.
 */
export async function createWorkspace({ name }) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Не авторизован");

  const workspaceId = generateId();
  const now = new Date().toISOString();

  const workspace = {
    id: workspaceId,
    userId: user.id,
    name,
    createdAt: now,
  };

  await put(STORES.WORKSPACES, workspace);

  // Параллельное создание типов задач для ускорения инициализации
  const typePromises = DEFAULT_TASK_TYPES.map((defType, index) =>
    put(STORES.TYPES, {
      id: generateId(),
      workspaceId,
      name: defType.name,
      color: defType.color,
      position: index + 1,
      createdAt: now,
    }),
  );

  await Promise.all(typePromises);

  return { id: workspace.id, name: workspace.name };
}

/**
 * Обновляет название рабочего пространства.
 *
 * @param {string} id - Идентификатор пространства.
 * @param {{ name: string }} params - Новые данные.
 * @returns {Promise<{ id: string, name: string }>} Обновлённое пространство.
 * @throws {Error} Если пространство не найдено.
 */
export async function updateWorkspace(id, { name }) {
  const workspace = await getByKey(STORES.WORKSPACES, id);
  if (!workspace) throw new Error("Пространство не найдено");

  workspace.name = name;
  await put(STORES.WORKSPACES, workspace);

  return { id: workspace.id, name: workspace.name };
}

/**
 * Удаляет рабочее пространство и все связанные данные (типы, задачи, подзадачи).
 * Выполняется последовательно, так как примитивы localDbCore открывают транзакцию
 * только для одного стора за раз.
 *
 * @param {string} id - Идентификатор пространства.
 * @returns {Promise<{ ok: boolean }>} Результат удаления.
 */
export async function deleteWorkspace(id) {
  const tasks = await getByIndex(STORES.TASKS, INDEXES.TASKS_WORKSPACE_ID, id);

  // Удаляем подзадачи и сами задачи
  for (const task of tasks) {
    const subtasks = await getByIndex(
      STORES.SUBTASKS,
      INDEXES.SUBTASKS_TASK_ID,
      task.id,
    );
    for (const sub of subtasks) {
      await remove(STORES.SUBTASKS, sub.id);
    }
    await remove(STORES.TASKS, task.id);
  }

  // Удаляем типы задач
  const types = await getByIndex(STORES.TYPES, INDEXES.TYPES_WORKSPACE_ID, id);
  for (const type of types) {
    await remove(STORES.TYPES, type.id);
  }

  // Удаляем само пространство
  await remove(STORES.WORKSPACES, id);

  return { ok: true };
}

/**
 * Возвращает список типов задач для указанного пространства.
 *
 * @param {string} workspaceId - Идентификатор пространства.
 * @returns {Promise<Array<object>>} Список типов.
 */
export async function types(workspaceId) {
  const result = await getByIndex(
    STORES.TYPES,
    INDEXES.TYPES_WORKSPACE_ID,
    workspaceId,
  );
  return result.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    position: t.position || 0,
  }));
}

/**
 * Создаёт новый тип задач в указанном пространстве.
 * Автоматически вычисляет следующую позицию (position) для корректной сортировки.
 *
 * @param {string} workspaceId - Идентификатор пространства.
 * @param {{ name: string, color?: string }} params - Данные типа.
 * @returns {Promise<object>} Созданный тип.
 */
export async function createType(workspaceId, { name, color }) {
  const existingTypes = await getByIndex(
    STORES.TYPES,
    INDEXES.TYPES_WORKSPACE_ID,
    workspaceId,
  );
  const maxPosition = existingTypes.reduce(
    (max, t) => Math.max(max, t.position || 0),
    0,
  );

  const type = {
    id: generateId(),
    workspaceId,
    name,
    color: color || DEFAULT_TYPE_COLOR,
    position: maxPosition + 1,
    createdAt: new Date().toISOString(),
  };

  await put(STORES.TYPES, type);
  return { id: type.id, name: type.name, color: type.color };
}

/**
 * Обновляет тип задач (название, цвет).
 *
 * @param {string} id - Идентификатор типа.
 * @param {{ name?: string, color?: string }} params - Новые данные.
 * @returns {Promise<object>} Обновлённый тип.
 * @throws {Error} Если тип не найден.
 */
export async function updateType(id, { name, color }) {
  const type = await getByKey(STORES.TYPES, id);
  if (!type) throw new Error("Тип не найден");

  if (name !== undefined) type.name = name;
  if (color !== undefined) type.color = color;

  await put(STORES.TYPES, type);
  return { id: type.id, name: type.name, color: type.color };
}

/**
 * Удаляет тип задач. Связанные задачи автоматически отвязываются (taskTypeId = null).
 *
 * @param {string} id - Идентификатор типа.
 * @returns {Promise<{ ok: boolean }>} Результат удаления.
 */
export async function deleteType(id) {
  const type = await getByKey(STORES.TYPES, id);

  // Отвязываем тип от всех задач в этом пространстве, чтобы избежать "висячих" ссылок
  if (type) {
    const affectedTasks = await getByIndex(
      STORES.TASKS,
      INDEXES.TASKS_WORKSPACE_ID,
      type.workspaceId,
    );
    for (const task of affectedTasks) {
      if (task.taskTypeId === id) {
        task.taskTypeId = null;
        await put(STORES.TASKS, task);
      }
    }
  }

  await remove(STORES.TYPES, id);
  return { ok: true };
}