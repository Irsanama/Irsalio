/**
 * @file Баррель-файл для модулей модальных окон и боковой панели.
 * @description Агрегирует и реэкспортирует публичные API из поддиректории `modals/`.
 *              Используется в `handlers.js` и других слоях для единой точки входа
 *              при открытии настроек, палитры, редактора типов и переключателя пространств.
 */

export { openTypeEditor } from "./modals/typeEditor.js";
export { openWorkspaceSwitcher } from "./modals/workspaceSwitcher.js";
export { openSettings } from "./modals/settings.js";
export { openPalette } from "./modals/palette.js";
export { openSidebar, closeSidebar } from "./modals/sidebar.js";