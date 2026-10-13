/**
 * @file Точка входа frontend-приложения Irsalio.
 * @description Отвечает исключительно за инициализацию: запускает bootstrapping через `boot()`,
 *              экспортирует `renderAll()` для полной перерисовки UI из любого модуля.
 */

import {
  renderWorkspaceButton,
  renderUserInfo,
  renderTopbar,
  renderTypeFilter,
} from "../render/renderLayout.js";
import {
  renderSidebarTabs,
  renderSidebarBody,
  renderAttentionCount,
} from "../render/renderSidebar.js";
import { renderContent } from "../render/renderContent.js";
import { boot } from "./handlers.js";

/**
 * Полностью перерисовывает все элементы интерфейса.
 * Вызывается при смене пространства, вкладки, фильтра или после мутаций данных.
 *
 * @returns {void}
 */
export function renderAll() {
  renderWorkspaceButton();
  renderSidebarTabs();
  renderSidebarBody();
  renderUserInfo();
  renderTopbar();
  renderTypeFilter();
  renderContent();
  renderAttentionCount();
}

// Запуск приложения
boot();