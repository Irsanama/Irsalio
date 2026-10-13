/**
 * @file Модальное окно переключения рабочих пространств.
 * @description Позволяет пользователю выбирать активное пространство,
 *              удалять существующие и создавать новые. При смене пространства
 *              автоматически сбрасывает фильтры, поиск и закрывает панель задачи,
 *              чтобы избежать отображения некорректных данных из другого контекста.
 */

import { el } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import {
  toast,
  openModal,
  confirmDialog,
  promptDialog,
} from "../../core/ui.js";
import { state, STORAGE_KEYS } from "../../state/state.js";
import { api } from "../../storage/api.js";
import { loadWorkspaceData } from "../auth.js";
import { renderAll } from "../../app/app.js";
import { closeTaskPanel } from "../taskPanel.js";

const DEFAULT_WORKSPACE_NAME = "Моё пространство";

/**
 * Сбрасывает контекст текущего рабочего пространства:
 * очищает фильтры, поиск, выбранный тип и закрывает панель задачи.
 * Вызывается при смене активного пространства для предотвращения
 * утечки состояния (например, отображения задач из другого пространства).
 */
function resetWorkspaceContext() {
  state.recordsView = "all";
  state.statusFilter = "";
  state.typeId = "";
  state.search = "";
  state.tasks = [];
  closeTaskPanel();
}

/**
 * Открывает модальное окно управления рабочими пространствами.
 * Предоставляет интерфейс для переключения, удаления и создания пространств.
 *
 * @returns {void}
 */
export function openWorkspaceSwitcher() {
  let modalRef = null;
  const list = el("div", { class: "workspace-list" });

  // Рендер списка существующих пространств
  state.workspaces.forEach((workspace) => {
    const isActive = workspace.id === state.workspaceId;
    const item = el("div", {
      class: `workspace-list-item${isActive ? " is-active" : ""}`,
    });

    // Кнопка переключения на пространство
    const switchBtn = el(
      "button",
      {
        class: "workspace-list-switch",
        onclick: async () => {
          if (isActive) return; // Уже активно, повторная загрузка не нужна

          state.workspaceId = workspace.id;
          localStorage.setItem(STORAGE_KEYS.workspaceId, workspace.id);

          resetWorkspaceContext();
          await loadWorkspaceData();
          renderAll();

          if (modalRef) modalRef.close();
        },
      },
      [
        el("span", { text: workspace.name }),
        isActive ? icon("check", 14) : null,
      ].filter(Boolean),
    );

    // Кнопка удаления пространства
    const deleteBtn = el(
      "button",
      {
        class: "icon-btn workspace-list-delete",
        "aria-label": `Удалить пространство ${workspace.name}`,
        title: "Удалить",
        onclick: async (e) => {
          e.stopPropagation();

          const confirmed = await confirmDialog({
            title: "Удалить пространство?",
            message: `«${workspace.name}» и все его записи будут удалены безвозвратно.`,
            confirmText: "Удалить",
            danger: true,
          });

          if (!confirmed) return;

          try {
            await api.deleteWorkspace(workspace.id);

            // Обновляем список пространств с бэкенда/локально
            const me = await api.me();
            state.workspaces = me.workspaces;

            // Если удалили активное пространство, нужно выбрать другое
            if (state.workspaceId === workspace.id) {
              state.workspaceId = state.workspaces[0]?.id || null;

              // Если пространств не осталось, создаём дефолтное,
              // чтобы у пользователя всегда было хотя бы одно рабочее пространство.
              if (!state.workspaceId) {
                const newWs = await api.createWorkspace({
                  name: DEFAULT_WORKSPACE_NAME,
                });
                state.workspaces.push(newWs);
                state.workspaceId = newWs.id;
              }

              localStorage.setItem(STORAGE_KEYS.workspaceId, state.workspaceId);
              resetWorkspaceContext();
              await loadWorkspaceData();
              renderAll();
            }

            toast("Пространство удалено", "success");
            if (modalRef) modalRef.close();
          } catch (err) {
            toast(err.message || "Ошибка удаления", "error");
          }
        },
      },
      [icon("trash", 14)],
    );

    item.append(switchBtn, deleteBtn);
    list.appendChild(item);
  });

  // Открытие модалки с кнопкой создания нового пространства
  modalRef = openModal({
    title: "Рабочие пространства",
    content: list,
    actions: [
      {
        label: "Создать новое",
        primary: true,
        onClick: async () => {
          const name = await promptDialog({
            title: "Новое пространство",
            label: "Название",
            placeholder: "Например: Работа",
          });

          if (!name) return false; // Отмена закрывает только промпт, не модалку

          try {
            const ws = await api.createWorkspace({ name });

            state.workspaces.push(ws);
            state.workspaceId = ws.id;
            localStorage.setItem(STORAGE_KEYS.workspaceId, ws.id);

            resetWorkspaceContext();
            await loadWorkspaceData();
            renderAll();

            toast("Пространство создано", "success");
          } catch (err) {
            toast(err.message || "Ошибка создания", "error");
            return false; // Оставляем модалку открытой при ошибке
          }
        },
      },
    ],
  });
}