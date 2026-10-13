/**
 * @file Модальное окно создания и редактирования типа задач.
 * @description Позволяет задать название и цвет типа. При редактировании
 *              добавляет кнопку удаления с подтверждением. После сохранения
 *              или удаления автоматически обновляет сайдбар и список задач.
 */

import { el } from "../../core/dom.js";
import { toast, openModal, confirmDialog } from "../../core/ui.js";
import { state, TYPE_COLORS } from "../../state/state.js";
import { api } from "../../storage/api.js";
import { loadTypes, loadTasks } from "../auth.js";
import { renderSidebarBody } from "../../render/renderSidebar.js";

/**
 * Открывает модальное окно для создания нового типа задач или редактирования существующего.
 * Если передан объект типа, окно открывается в режиме редактирования с предзаполненными полями
 * и дополнительной кнопкой удаления.
 *
 * @param {object|null} [type=null] - Объект типа для редактирования или null для создания нового.
 * @returns {void}
 */
export function openTypeEditor(type = null) {
  // Начальный цвет берётся из палитры TYPE_COLORS, чтобы гарантировать
  // корректное отображение активного состояния в UI.
  const defaultColor =
    TYPE_COLORS[Math.floor(Math.random() * TYPE_COLORS.length)];
  let selectedColor = type?.color || defaultColor;

  const nameInput = el("input", {
    class: "input",
    placeholder: "Название типа",
    value: type?.name || "",
    style: { width: "100%" },
  });

  const palette = el("div", { class: "color-palette" });

  /**
   * Обновляет визуальное состояние кнопок выбора цвета.
   */
  const refreshPalette = () => {
    [...palette.children].forEach((swatch) => {
      swatch.classList.toggle(
        "is-active",
        swatch.dataset.color === selectedColor,
      );
    });
  };

  TYPE_COLORS.forEach((color) => {
    palette.appendChild(
      el("button", {
        type: "button",
        class: `color-swatch${selectedColor === color ? " is-active" : ""}`,
        dataset: { color },
        style: { background: color },
        "aria-label": `Выбрать цвет ${color}`,
        onclick: () => {
          selectedColor = color;
          refreshPalette();
        },
      }),
    );
  });
  refreshPalette();

  const actions = [
    { label: "Отмена", onClick: () => {} },
    {
      label: "Сохранить",
      primary: true,
      onClick: async () => {
        const name = nameInput.value.trim();
        if (!name) {
          toast("Название типа обязательно", "error");
          return false;
        }

        try {
          if (type) {
            await api.updateType(type.id, { name, color: selectedColor });
          } else {
            await api.createType(state.workspaceId, {
              name,
              color: selectedColor,
            });
          }

          toast("Тип сохранён", "success");
          await loadTypes();
          renderSidebarBody();
          await loadTasks();
        } catch (err) {
          toast(err.message, "error");
          return false;
        }
      },
    },
  ];

  // Для существующего типа добавляем кнопку удаления в начало списка действий
  if (type) {
    actions.unshift({
      label: "Удалить",
      danger: true,
      onClick: async () => {
        const confirmed = await confirmDialog({
          title: "Удалить тип?",
          message: "Записи останутся, но будут «Без типа».",
          confirmText: "Удалить",
          danger: true,
        });

        if (!confirmed) return;

        try {
          await api.deleteType(type.id);
          toast("Тип удалён", "success");

          // Сбрасываем фильтр, если удаляемый тип был выбран
          if (state.typeId === type.id) {
            state.typeId = "";
          }

          await loadTypes();
          renderSidebarBody();
          await loadTasks();
        } catch (err) {
          toast(err.message, "error");
          return false;
        }
      },
    });
  }

  openModal({
    title: type ? "Редактировать тип" : "Новый тип записи",
    content: [
      el("div", { class: "field" }, [
        el("span", { class: "field-label", text: "Название" }),
        nameInput,
      ]),
      el("div", { class: "field" }, [
        el("span", { class: "field-label", text: "Цвет" }),
        palette,
      ]),
    ],
    actions,
  });
}