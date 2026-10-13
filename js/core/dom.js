/**
 * @file Базовые утилиты для работы с DOM.
 * @description Предоставляет функции поиска, очистки, фабрику элементов и debounce.
 *              Используется во всех слоях приложения для создания и манипуляции узлами.
 */

/**
 * Находит первый элемент, соответствующий CSS-селектору.
 *
 * @param {string} selector - CSS-селектор.
 * @param {ParentNode} [root=document] - Контекст поиска.
 * @returns {Element | null} Найденный элемент или null.
 */
export function $(selector, root = document) {
  return root.querySelector(selector);
}

/**
 * Удаляет всех дочерних элементов узла.
 * Более производительно и безопасно, чем innerHTML = ''.
 *
 * @param {Node} node - Родительский узел для очистки.
 */
export function clear(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

/**
 * Фабрика для создания DOM-элементов с атрибутами и дочерними узлами.
 * Поддерживает обработку class, text, html, dataset, style, событий и свойств.
 *
 * @param {string} tag - Имя тега (например, 'div', 'button').
 * @param {object} [attrs={}] - Объект атрибутов и свойств.
 * @param {Array<Node|string|boolean|null|undefined>|Node|string} [children=[]] - Дочерние узлы или текст.
 * @returns {HTMLElement} Созданный DOM-элемент.
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === "class") {
      node.className = value;
    } else if (key === "text") {
      node.textContent = value;
    } else if (key === "html") {
      // innerHTML используется только для контролируемого контента (иконки, санитизированный markdown)
      node.innerHTML = value;
    } else if (key === "dataset") {
      Object.assign(node.dataset, value);
    } else if (key === "style" && typeof value === "object") {
      for (const [prop, val] of Object.entries(value)) {
        if (prop.startsWith("--")) {
          node.style.setProperty(prop, val);
        } else {
          node.style[prop] = val;
        }
      }
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node && typeof value !== "object") {
      // Установка нативных свойств (checked, value, disabled и т.д.)
      node[key] = value;
    } else {
      node.setAttribute(key, value);
    }
  }

  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;

    if (child.nodeType) {
      node.appendChild(child);
    } else {
      node.appendChild(document.createTextNode(String(child)));
    }
  }

  return node;
}

/**
 * Создаёт функцию с задержкой выполнения (debounce).
 * Сбрасывает таймер при каждом вызове, выполняя исходную функцию
 * только после паузы длительностью `ms`.
 *
 * @param {Function} fn - Функция для отложенного вызова.
 * @param {number} [ms=300] - Задержка в миллисекундах.
 * @returns {Function} Обёрнутая функция.
 */
export function debounce(fn, ms = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}