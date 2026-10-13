/**
 * @file Локальная реализация аутентификации и управления профилем.
 * @description Работает с IndexedDB через примитивы из localDbCore.js.
 *              Использует SHA-256 для хэширования паролей (в отличие от scrypt на сервере).
 *              Токены генерируются как UUID и хранятся в store META.
 */

import {
  withStore,
  put,
  getByKey,
  getByIndex,
  generateId,
  hashPassword,
  setToken,
  getCurrentUser,
  STORES,
  INDEXES,
} from "./localDbCore.js";

const TOKEN_KEY_PREFIX = "token:";

/**
 * Регистрирует нового пользователя в локальной базе.
 * Создаёт запись в USERS, генерирует токен и сохраняет его в META.
 *
 * @param {object} params - Параметры регистрации.
 * @param {string} params.username - Логин пользователя.
 * @param {string} [params.displayName] - Отображаемое имя.
 * @param {string} params.password - Пароль в открытом виде.
 * @returns {Promise<{token: string, user: object}>} Токен и данные пользователя.
 * @throws {Error} Если логин уже занят.
 */
export async function register({ username, displayName, password }) {
  const existing = await withStore(STORES.USERS, "readonly", (store) =>
    store.index(INDEXES.USERS_USERNAME).get(username),
  );

  if (existing) {
    throw new Error("Пользователь с таким логином уже существует");
  }

  const passwordHash = await hashPassword(password);
  const userId = generateId();
  const user = {
    id: userId,
    username,
    displayName: displayName || username,
    passwordHash,
    createdAt: new Date().toISOString(),
  };

  await put(STORES.USERS, user);

  const token = generateId();
  await put(STORES.META, { key: TOKEN_KEY_PREFIX + token, userId });
  setToken(token);

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
    },
  };
}

/**
 * Выполняет вход пользователя по логину и паролю.
 * Сравнивает SHA-256 хэши, генерирует новый токен при успехе.
 *
 * @param {object} params - Параметры входа.
 * @param {string} params.username - Логин пользователя.
 * @param {string} params.password - Пароль в открытом виде.
 * @returns {Promise<{token: string, user: object}>} Токен и данные пользователя.
 * @throws {Error} Если логин или пароль неверны.
 */
export async function login({ username, password }) {
  const user = await withStore(STORES.USERS, "readonly", (store) =>
    store.index(INDEXES.USERS_USERNAME).get(username),
  );

  if (!user) {
    throw new Error("Неверный логин или пароль");
  }

  const passwordHash = await hashPassword(password);
  if (user.passwordHash !== passwordHash) {
    throw new Error("Неверный логин или пароль");
  }

  const token = generateId();
  await put(STORES.META, { key: TOKEN_KEY_PREFIX + token, userId: user.id });
  setToken(token);

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
    },
  };
}

/**
 * Возвращает данные текущего авторизованного пользователя и список его пространств.
 *
 * @returns {Promise<{user: object, workspaces: Array<object>}>}
 * @throws {Error} Если пользователь не авторизован.
 */
export async function me() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Не авторизован");
  }

  const workspaces = await getByIndex(
    STORES.WORKSPACES,
    INDEXES.WORKSPACES_USER_ID,
    user.id,
  );

  return {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
    },
    workspaces: workspaces.map((w) => ({ id: w.id, name: w.name })),
  };
}

/**
 * Обновляет отображаемое имя текущего пользователя.
 *
 * @param {object} params - Параметры обновления.
 * @param {string} params.displayName - Новое отображаемое имя.
 * @returns {Promise<{user: object}>} Обновлённые данные пользователя.
 * @throws {Error} Если пользователь не авторизован.
 */
export async function updateProfile({ displayName }) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Не авторизован");
  }

  user.displayName = displayName;
  await put(STORES.USERS, user);

  return {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
    },
  };
}

/**
 * Меняет пароль текущего пользователя.
 * Проверяет старый пароль, хэширует новый и сохраняет его.
 *
 * @param {object} params - Параметры смены пароля.
 * @param {string} params.oldPassword - Текущий пароль.
 * @param {string} params.newPassword - Новый пароль.
 * @returns {Promise<{user: object}>} Обновлённые данные пользователя.
 * @throws {Error} Если пользователь не авторизован или старый пароль неверен.
 */
export async function changePassword({ oldPassword, newPassword }) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Не авторизован");
  }

  const oldHash = await hashPassword(oldPassword);
  if (user.passwordHash !== oldHash) {
    throw new Error("Неверный текущий пароль");
  }

  user.passwordHash = await hashPassword(newPassword);
  await put(STORES.USERS, user);

  return {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
    },
  };
}