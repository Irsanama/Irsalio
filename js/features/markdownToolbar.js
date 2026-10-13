/**
 * @file Панель инструментов Markdown для текстовых полей.
 * @description Предоставляет функции для создания UI-панели форматирования
 *              и применения Markdown-синтаксиса к выделенному тексту в textarea.
 *              Поддерживает как inline-форматирование (жирный, код),
 *              так и блочное (заголовки, списки), корректно обрабатывая
 *              многострочные выделения.
 */

import { el } from "../core/dom.js";


/**
 * Конфигурация кнопок панели инструментов.
 * Порядок массива определяет порядок отображения кнопок в UI.
 *
 * @type {ReadonlyArray<{action: string, label: string, title: string}>}
 */
const TOOLBAR_ACTIONS = Object.freeze([
  { action: "bold", label: "B", title: "Жирный (**текст**)" },
  { action: "italic", label: "I", title: "Курсив (*текст*)" },
  { action: "h1", label: "H1", title: "Заголовок 1 (# текст)" },
  { action: "h2", label: "H2", title: "Заголовок 2 (## текст)" },
  { action: "h3", label: "H3", title: "Заголовок 3 (### текст)" },
  { action: "ul", label: "•", title: "Маркированный список (- пункт)" },
  { action: "ol", label: "1.", title: "Нумерованный список (1. пункт)" },
  { action: "checklist", label: "☑", title: "Чек-лист (- [ ] задача)" },
  { action: "link", label: "🔗", title: "Ссылка ([текст](url))" },
  { action: "code", label: "<>", title: "Inline-код (`код`)" },
  { action: "codeblock", label: "{}", title: "Блок кода (```код```)" },
  { action: "quote", label: ">", title: "Цитата (> текст)" },
]);

/**
 * Словарь обёрток для inline-форматирования.
 *
 * @type {Readonly<Record<string, [string, string]>>}
 */
const INLINE_WRAPPERS = Object.freeze({
  bold: ["**", "**"],
  italic: ["*", "*"],
  code: ["`", "`"],
  link: ["[", "](url)"],
  codeblock: ["```\n", "\n```"],
});

/**
 * Словарь плейсхолдеров для inline-форматирования (если выделение пустое).
 *
 * @type {Readonly<Record<string, string>>}
 */
const INLINE_PLACEHOLDERS = Object.freeze({
  bold: "жирный текст",
  italic: "курсив",
  code: "код",
  link: "текст ссылки",
  codeblock: "код",
});

/**
 * Словарь префиксов для блочного форматирования.
 *
 * @type {Readonly<Record<string, string>>}
 */
const BLOCK_PREFIXES = Object.freeze({
  h1: "# ",
  h2: "## ",
  h3: "### ",
  ul: "- ",
  ol: "1. ",
  checklist: "- [ ] ",
  quote: "> ",
});

/* ══════════════════════════════════════════════════════════
СОЗДАНИЕ UI ПАНЕЛИ
══════════════════════════════════════════════════════════ */

/**
 * Создаёт DOM-элемент панели инструментов Markdown.
 * Кнопки используют текстовые лейблы вместо SVG-иконок,
 * так как стандартный набор icons.js не содержит символов форматирования.
 *
 * @param {HTMLTextAreaElement} textarea - Целевое текстовое поле.
 * @returns {HTMLElement} Контейнер панели инструментов.
 */
export function buildMarkdownToolbar(textarea) {
  const toolbar = el("div", { class: "markdown-toolbar" });

  TOOLBAR_ACTIONS.forEach(({ action, label, title }) => {
    const btn = el("button", {
      type: "button",
      class: "markdown-toolbar-btn",
      title,
      text: label,
      onclick: (e) => {
        e.preventDefault();
        applyMarkdownAction(action, textarea);
      },
    });

    // Визуальное выделение кнопок жирного и курсивного начертания
    if (action === "bold") btn.style.fontWeight = "700";
    if (action === "italic") btn.style.fontStyle = "italic";

    toolbar.appendChild(btn);
  });

  return toolbar;
}


/**
 * Применяет Markdown-действие к содержимому textarea.
 *
 * Логика обработки:
 * - Inline-действия (bold, italic, code, link): оборачивают выделение
 *   или вставляют шаблон с плейсхолдером, если выделение пустое.
 * - Блочные действия (h1-h3, списки, цитата): добавляют префикс
 *   к КАЖДОЙ строке в выделении, что соответствует ожидаемому
 *   поведению редакторов Markdown.
 *
 * После модификации текста восстанавливает фокус и выделение,
 * а также диспатчит событие 'input' для триггера dirty-state.
 *
 * @param {string} action - Идентификатор действия (например, 'bold', 'h1').
 * @param {HTMLTextAreaElement} textarea - Целевое текстовое поле.
 */
export function applyMarkdownAction(action, textarea) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const selected = text.substring(start, end);

  let newText = text;
  let newStart = start;
  let newEnd = end;

  // --- INLINE: обёртки ---
  if (INLINE_WRAPPERS[action]) {
    const [before, after] = INLINE_WRAPPERS[action];
    const placeholder = selected || INLINE_PLACEHOLDERS[action];

    newText =
      text.substring(0, start) +
      before +
      placeholder +
      after +
      text.substring(end);
    newStart = start + before.length;
    newEnd = newStart + placeholder.length;
  }
  // --- BLOCK: префиксы строк ---
  else if (BLOCK_PREFIXES[action]) {
    const prefix = BLOCK_PREFIXES[action];

    if (selected) {
      // Для блочных действий префикс добавляется к каждой строке выделения
      const lines = selected.split("\n");
      const prefixedLines = lines.map((line) => prefix + line);
      const newSelected = prefixedLines.join("\n");

      newText = text.substring(0, start) + newSelected + text.substring(end);
      newStart = start;
      newEnd = start + newSelected.length;
    } else {
      // Если выделения нет, вставляем новую строку с префиксом и плейсхолдером
      const needsNewline = start > 0 && text[start - 1] !== "\n";
      const linePrefix = needsNewline ? "\n" : "";
      const placeholder = "текст";
      const insertText = linePrefix + prefix + placeholder;

      newText = text.substring(0, start) + insertText + text.substring(end);
      newStart = start + insertText.length - placeholder.length;
      newEnd = start + insertText.length;
    }
  }

  // Применяем изменения и восстанавливаем фокус/выделение
  textarea.value = newText;
  textarea.focus();
  textarea.setSelectionRange(newStart, newEnd);

  // Триггерим input для обновления dirty state и автосейва
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}