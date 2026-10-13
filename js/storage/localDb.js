/**
 * @file Баррель-файл локального хранилища (IndexedDB).
 * @description Агрегирует и реэкспортирует единый API для работы с локальной БД.
 *              Импортируется в `api.js` как `{ localDb, initLocalDb }` для обеспечения
 *              прозрачного переключения между серверным и локальным режимами.
 */

import { initLocalDb, getToken, setToken, clearToken } from "./localDbCore.js";
import {
  register,
  login,
  me,
  updateProfile,
  changePassword,
} from "./localDbAuth.js";
import {
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  types,
  createType,
  updateType,
  deleteType,
} from "./localDbWorkspaces.js";
import {
  tasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  restoreTask,
  permanentDeleteTask,
  createSubtask,
  updateSubtask,
  deleteSubtask,
} from "./localDbTasks.js";
import {
  search,
  exportWorkspace,
  importWorkspace,
  getStorageStats,
  clearAllLocalData,
} from "./localDbExtra.js";

/**
 * Единый объект локального API.
 * Повторяет сигнатуры серверного API (`serverApi`), чтобы фасад `api.js`
 * мог бесшовно подменять бэкенд в зависимости от выбранного режима.
 *
 * @type {object}
 */
export const localDb = {
  // Auth
  register,
  login,
  me,
  updateProfile,
  changePassword,

  // Workspaces
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,

  // Task Types
  types,
  createType,
  updateType,
  deleteType,

  // Tasks
  tasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  restoreTask,
  permanentDeleteTask,

  // Subtasks
  createSubtask,
  updateSubtask,
  deleteSubtask,

  // Extra
  search,
  exportWorkspace,
  importWorkspace,
  getStorageStats,
  clearAllLocalData,

  // Token management (дублирует методы из localDbCore для совместимости с api.js)
  getToken,
  setToken,
  clearToken,
};

export { initLocalDb };
