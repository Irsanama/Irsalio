/**
 * @file Простой Event Bus на базе CustomEvent.
 * @description Используется для разрыва циклических зависимостей между слоями render и features.
 *              Слой представления (render) не импортирует слой бизнес-логики (features),
 *              а лишь отправляет события, на которые подписываются обработчики.
 */

/**
 * Глобальная шина событий для коммуникации между модулями.
 * Работает через нативный CustomEvent на объекте document.
 *
 * @type {{emit: Function, on: Function, off: Function}}
 */
export const EventBus = {
  /**
   * Генерирует глобальное событие.
   *
   * @param {string} name - Имя события (например, 'irsalio:reload').
   * @param {any} [data] - Полезная нагрузка события.
   */
  emit(name, data) {
    document.dispatchEvent(new CustomEvent(name, { detail: data }));
  },

  /**
   * Подписывается на глобальное событие.
   *
   * @param {string} name - Имя события.
   * @param {Function} handler - Функция-обработчик.
   */
  on(name, handler) {
    document.addEventListener(name, handler);
  },

  /**
   * Отписывается от глобального события.
   *
   * @param {string} name - Имя события.
   * @param {Function} handler - Функция-обработчик.
   */
  off(name, handler) {
    document.removeEventListener(name, handler);
  },
};