/**
 * @file Рендеринг и санитизация Markdown-текста.
 * @description Преобразует Markdown в безопасный HTML, используя глобальную
 *              библиотеку marked.js (загружается через <script> в index.html).
 *              Включает строгую санитизацию для предотвращения XSS-атак:
 *              удаляет опасные теги, скриптовые атрибуты и вредоносные URI.
 */

/**
 * Список тегов, которые считаются потенциально опасными и подлежат удалению.
 * Заморожен для предотвращения случайных мутаций.
 *
 * @type {ReadonlyArray<string>}
 */
const DANGEROUS_TAGS = Object.freeze([
  "script",
  "iframe",
  "object",
  "embed",
  "form",
  "base",
  "link",
  "meta",
  "applet",
  "style",
]);

/**
 * Рендерит Markdown-текст в безопасный HTML.
 * Если библиотека marked недоступна, возвращает экранированный plain text.
 *
 * @param {string} text - Исходный Markdown-текст.
 * @returns {string} Безопасный HTML-код.
 */
export function renderMarkdown(text) {
  if (!text || !String(text).trim()) return "";

  // Fallback, если marked.js не загрузился (например, при открытии file:// без сервера)
  if (typeof window === "undefined" || !window.marked) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, "<br>");
  }

  try {
    const rawHtml = window.marked.parse(text);

    // Парсим HTML в DOM-документ
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, "text/html");

    // Удаление опасных тегов
    DANGEROUS_TAGS.forEach((tag) => {
      doc.querySelectorAll(tag).forEach((el) => el.remove());
    });

    // Обход всех элементов для очистки атрибутов и защиты ссылок
    const allElements = doc.body.querySelectorAll("*");
    allElements.forEach((el) => {
      const attrs = [...el.attributes];
      attrs.forEach((attr) => {
        const attrName = attr.name.toLowerCase();

        // Удаление обработчиков событий (onclick, onerror, onmouseover и т.д.)
        if (attrName.startsWith("on")) {
          el.removeAttribute(attr.name);
          return;
        }

        // Проверка URI-атрибутов
        if (
          attrName === "href" ||
          attrName === "src" ||
          attrName === "action"
        ) {
          const val = attr.value.trim().toLowerCase();
          if (
            val.startsWith("javascript:") ||
            val.startsWith("vbscript:") ||
            val.startsWith("data:text/html")
          ) {
            el.removeAttribute(attr.name);
          }
        }
      });

      // Безопасное открытие внешних ссылок в новой вкладке
      if (el.tagName === "A") {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
    });

    return doc.body.innerHTML;
  } catch (err) {
    console.error("[renderMarkdown] Ошибка парсинга Markdown:", err);
    // Fallback при критической ошибке парсера
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, "<br>");
  }
}