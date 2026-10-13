/**
 * @file Управление мобильным сайдбаром.
 * @description Отвечает за открытие и закрытие боковой панели на мобильных устройствах.
 *              Добавляет/удаляет CSS-класс на body и управляет видимостью затемняющего фона.
 */

import { $ } from "../../core/dom.js";

/**
 * Открывает мобильный сайдбар.
 * Добавляет класс `sidebar-open` на body и показывает затемняющий фон.
 *
 * @returns {void}
 */
export function openSidebar() {
  document.body.classList.add("sidebar-open");

  const backdrop = $("#sidebar-backdrop");
  if (backdrop) backdrop.hidden = false;
}

/**
 * Закрывает мобильный сайдбар.
 * Удаляет класс `sidebar-open` с body и скрывает затемняющий фон.
 *
 * @returns {void}
 */
export function closeSidebar() {
  document.body.classList.remove("sidebar-open");

  const backdrop = $("#sidebar-backdrop");
  if (backdrop) backdrop.hidden = true;
}