/**
 * @file Базовые UI-компоненты: тосты, модальные окна, диалоги.
 * @description Предоставляет функции для отображения всплывающих уведомлений (toast),
 *              универсальных модальных окон (openModal) и специализированных диалогов
 *              подтверждения (confirmDialog) и ввода текста (promptDialog).
 *              Использует AbortController для гарантированной очистки глобальных слушателей
 *              при закрытии модалок.
 */

import { $, el } from "./dom.js";
import { icon } from "./icons.js";

const TOAST_DISPLAY_MS = 3000;
const TOAST_LEAVE_MS = 200;
const PROMPT_FOCUS_DELAY_MS = 50;

/**
 * Показывает всплывающее уведомление (тост).
 * Автоматически скрывается через 3 секунды.
 *
 * @param {string} message - Текст уведомления.
 * @param {"info"|"success"|"error"} [type="info"] - Визуальный тип.
 * @returns {void}
 */
export function toast(message, type = "info") {
  const root = $("#toast-root");
  if (!root) return;

  const item = el("div", {
    class: `toast is-${type}`,
    text: message,
    role: "status",
    "aria-live": "polite",
  });

  root.appendChild(item);

  setTimeout(() => {
    item.classList.add("is-leaving");
    setTimeout(() => item.remove(), TOAST_LEAVE_MS);
  }, TOAST_DISPLAY_MS);
}

let modalCounter = 0;

/**
 * Открывает модальное окно с заданным контентом и кнопками действий.
 * Гарантирует корректное управление фокусом и очистку глобальных слушателей
 * при закрытии.
 *
 * @param {object} options - Параметры модалки.
 * @param {string} [options.title] - Заголовок.
 * @param {Node|Node[]|string|null} [options.content] - Контент.
 * @param {Array<{label: string, onClick: Function, primary?: boolean, danger?: boolean}>} [options.actions] - Кнопки.
 * @returns {{ close: Function }} Объект управления модалкой.
 */
export function openModal({ title, content, actions = [] }) {
  const root = $("#modal-root");
  if (!root) return { close: () => {} };

  const previouslyFocused = document.activeElement;
  const modalId = `modal-title-${++modalCounter}`;

  const abortController = new AbortController();
  const { signal } = abortController;

  const body = el("div", { class: "modal-body" });
  if (Array.isArray(content)) {
    content.forEach((item) => body.append(item));
  } else if (content) {
    body.append(content);
  }

  const footer = el("div", { class: "modal-footer" });
  actions.forEach((action) => {
    const btnClass = action.danger
      ? "btn btn-danger"
      : action.primary
        ? "btn btn-primary"
        : "btn btn-secondary";

    const btn = el("button", {
      class: btnClass,
      text: action.label,
      onclick: async () => {
        try {
          const result = await action.onClick();
          if (result !== false) close();
        } catch (e) {
          console.error(e);
          toast("Ошибка выполнения действия", "error");
        }
      },
    });
    footer.appendChild(btn);
  });

  const closeBtn = el(
    "button",
    { class: "icon-btn", "aria-label": "Закрыть", onclick: close },
    [icon("x", 16)],
  );

  const modal = el(
    "div",
    {
      class: "modal",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": modalId,
    },
    [
      el("div", { class: "modal-header" }, [
        el("h2", { class: "modal-title", id: modalId, text: title }),
        closeBtn,
      ]),
      body,
      footer,
    ],
  );

  const overlay = el("div", { class: "modal-overlay" }, [modal]);

  function close() {
    if (!overlay.isConnected) return;
    abortController.abort();
    overlay.remove();
    if (previouslyFocused instanceof HTMLElement) {
      previouslyFocused.focus();
    }
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") close();
    },
    { signal },
  );

  overlay.addEventListener(
    "mousedown",
    (e) => {
      if (e.target === overlay) close();
    },
    { signal },
  );

  root.appendChild(overlay);

  const focusable = modal.querySelector("button, input, select, textarea");
  if (focusable) focusable.focus();

  return { close };
}

/**
 * Показывает модальное окно подтверждения.
 *
 * @param {object} options - Параметры диалога.
 * @param {string} [options.title="Подтверждение"] - Заголовок.
 * @param {string} [options.message=""] - Текст сообщения.
 * @param {string} [options.confirmText="Подтвердить"] - Текст кнопки подтверждения.
 * @param {string} [options.cancelText="Отмена"] - Текст кнопки отмены.
 * @param {boolean} [options.danger=false] - Использовать красный стиль для подтверждения.
 * @returns {Promise<boolean>} True, если пользователь подтвердил действие.
 */
export function confirmDialog({
  title = "Подтверждение",
  message = "",
  confirmText = "Подтвердить",
  cancelText = "Отмена",
  danger = false,
}) {
  return new Promise((resolve) => {
    openModal({
      title,
      content: el("p", { text: message }),
      actions: [
        { label: cancelText, onClick: () => resolve(false) },
        {
          label: confirmText,
          danger,
          primary: !danger,
          onClick: () => resolve(true),
        },
      ],
    });
  });
}

/**
 * Показывает модальное окно с полем ввода текста.
 *
 * @param {object} options - Параметры диалога.
 * @param {string} [options.title="Ввод"] - Заголовок.
 * @param {string} [options.label="Значение"] - Метка поля.
 * @param {string} [options.defaultValue=""] - Начальное значение.
 * @param {string} [options.placeholder=""] - Плейсхолдер.
 * @param {string} [options.confirmText="Сохранить"] - Текст кнопки сохранения.
 * @returns {Promise<string|null>} Введённая строка или null при отмене.
 */
export function promptDialog({
  title = "Ввод",
  label = "Значение",
  defaultValue = "",
  placeholder = "",
  confirmText = "Сохранить",
}) {
  return new Promise((resolve) => {
    const input = el("input", {
      class: "input settings-input",
      value: defaultValue,
      placeholder,
      style: { width: "100%" },
    });

    openModal({
      title,
      content: el("div", {}, [
        el("label", { class: "field" }, [
          el("span", { class: "field-label", text: label }),
          input,
        ]),
      ]),
      actions: [
        { label: "Отмена", onClick: () => resolve(null) },
        {
          label: confirmText,
          primary: true,
          onClick: () => resolve(input.value.trim() || null),
        },
      ],
    });

    setTimeout(() => input.focus(), PROMPT_FOCUS_DELAY_MS);
  });
}