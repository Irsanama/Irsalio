/**
 * @file Модуль панели задачи (Task Panel).
 * @description Отвечает за открытие, закрытие и рендеринг боковой панели задачи
 *              в режимах просмотра и редактирования. Поддерживает Markdown,
 *              управление подзадачами и отслеживание несохранённых изменений (dirty state).
 */

import { $, el, clear } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { toast, confirmDialog } from "../core/ui.js";
import {
  toDatetimeLocalValue,
  getDueState,
  formatDueRange,
  parseLocalDate,
} from "../core/dates.js";
import { state, PRIORITY_LABELS, STATUS_LABELS } from "../state/state.js";
import { api } from "../storage/api.js";
import { refreshTasks } from "./auth.js";
import { renderMarkdown } from "./markdown.js";
import { buildMarkdownToolbar } from "./markdownToolbar.js";


/**
 * Помечает панель как имеющую несохранённые изменения.
 */
function markDirty() {
  state.panelDirty = true;
}

/**
 * Отображает панель задач и затемняющий фон на экране.
 */
function showPanel() {
  $("#task-panel").hidden = false;
  const backdrop = $("#task-panel-backdrop");
  if (backdrop) backdrop.hidden = false;
  document.body.classList.add("task-panel-open");
}

/**
 * Переключает панель в режим редактирования и сбрасывает флаг dirty.
 */
function switchToEdit() {
  state.panelMode = "edit";
  state.panelDirty = false;
  renderTaskPanel();
}

/**
 * Переключает панель в режим просмотра и сбрасывает флаг dirty.
 */
function switchToView() {
  state.panelMode = "view";
  state.panelDirty = false;
  renderTaskPanel();
}


/**
 * Открывает панель задачи для просмотра или редактирования.
 * Если передан taskId и панель уже открыта для этой задачи в режиме просмотра,
 * панель закрывается (работает как тоггл).
 *
 * @param {string|null} [taskId=null] - ID задачи или null для создания новой.
 * @param {'view'|'edit'} [mode='view'] - Режим открытия.
 * @param {object} [defaults={}] - Предустановленные значения для новой задачи (например, dueAt).
 * @returns {Promise<void>}
 */
export async function openTaskPanel(
  taskId = null,
  mode = "view",
  defaults = {},
) {
  // Тоггл: если кликнули по уже открытой задаче в режиме просмотра — закрываем
  if (
    taskId &&
    state.editingTaskId === taskId &&
    state.panelMode === "view" &&
    !$("#task-panel").hidden
  ) {
    closeTaskPanel();
    return;
  }

  state.panelMode = mode;
  state.panelDirty = false;
  state.editingTaskId = taskId;
  state.newTaskDefaults = taskId ? {} : defaults;

  showPanel();
  await renderTaskPanel();
}

/**
 * Закрывает панель задач, сбрасывает состояние и скрывает фон.
 */
export function closeTaskPanel() {
  state.panelMode = null;
  state.panelDirty = false;
  state.editingTaskId = null;
  state.newTaskDefaults = {};

  $("#task-panel").hidden = true;
  const backdrop = $("#task-panel-backdrop");
  if (backdrop) backdrop.hidden = true;
  document.body.classList.remove("task-panel-open");
}

/**
 * Обработчик запроса на закрытие панели.
 * Если есть несохранённые изменения, запрашивает подтверждение у пользователя.
 *
 * @returns {Promise<void>}
 */
async function handlePanelClose() {
  if (state.panelMode === "edit" && state.panelDirty) {
    const ok = await confirmDialog({
      title: "Несохранённые изменения",
      message: "Есть несохранённые изменения. Отменить?",
      confirmText: "Отменить",
      cancelText: "Продолжить",
    });
    if (!ok) return;
  }
  closeTaskPanel();
}

/**
 * Полностью перерисовывает содержимое панели задач.
 * Автоматически определяет, какой режим рендерить (view или edit).
 *
 * @returns {Promise<void>}
 */
export async function renderTaskPanel() {
  const panel = $("#task-panel");
  clear(panel);

  let task = null;
  if (state.editingTaskId) {
    try {
      // Ищем сначала в локальном кэше state.tasks, иначе запрашиваем с бэкенда
      task =
        state.tasks.find((t) => t.id === state.editingTaskId) ||
        (await api.getTask(state.editingTaskId));
    } catch {
      // Если задача удалена или недоступна, закрываем панель
      closeTaskPanel();
      return;
    }
  }

  // Если задача не найдена, но мы в режиме просмотра, принудительно переходим в редактирование
  const mode =
    state.panelMode === "view" && !task ? "edit" : state.panelMode || "edit";

  if (mode === "view" && task) {
    renderViewMode(task);
  } else {
    renderEditMode(task, state.newTaskDefaults || {});
  }
}


/**
 * Рендерит панель в режиме просмотра (только чтение).
 *
 * @param {object} task - Объект задачи.
 */
function renderViewMode(task) {
  const panel = $("#task-panel");
  const isTrash = Boolean(task.deleted_at);

  const header = el("div", {
    class: "task-panel-header task-panel-view-header",
  });
  const title = el("h2", { class: "task-panel-view-title", text: task.title });
  const actions = el("div", { class: "task-panel-view-actions" });

  if (!isTrash) {
    actions.appendChild(
      el(
        "button",
        {
          class: "icon-btn",
          "aria-label": "Редактировать",
          title: "Редактировать",
          onclick: switchToEdit,
        },
        [icon("pencil", 16)],
      ),
    );
    actions.appendChild(
      el(
        "button",
        {
          class: "icon-btn",
          "aria-label": "Удалить",
          title: "Удалить",
          onclick: async () => {
            const ok = await confirmDialog({
              title: "Удалить задачу?",
              message: `«${task.title}» будет перемещена в корзину.`,
              confirmText: "Удалить",
              danger: true,
            });
            if (!ok) return;
            await api.deleteTask(task.id);
            toast("Удалено", "success");
            closeTaskPanel();
            await refreshTasks();
          },
        },
        [icon("trash", 16)],
      ),
    );
  }

  actions.appendChild(
    el(
      "button",
      {
        class: "icon-btn",
        "aria-label": "Закрыть",
        title: "Закрыть",
        onclick: handlePanelClose,
      },
      [icon("x", 16)],
    ),
  );

  header.append(title, actions);
  panel.appendChild(header);

  const body = el("div", { class: "panel-body" });

  // Бейджи
  const badges = el("div", { class: "task-panel-badges" });
  badges.appendChild(
    el("span", {
      class: `badge status-${task.status}`,
      text: STATUS_LABELS[task.status] || task.status,
    }),
  );
  badges.appendChild(
    el("span", {
      class: `badge badge-priority-${task.priority || 2}`,
      text: PRIORITY_LABELS[task.priority] || PRIORITY_LABELS[2],
    }),
  );
  if (task.type_name) {
    badges.appendChild(
      el("span", {
        class: "badge badge-type",
        style: { "--type-color": task.type_color || "#6f6a63" },
        text: task.type_name,
      }),
    );
  }
  body.appendChild(badges);

  // Срок
  const dueText = formatDueRange(task.due_at, task.due_end_at);
  if (dueText) {
    body.appendChild(
      el("div", { class: "task-panel-due" }, [
        icon("clock", 14),
        el("span", { text: dueText }),
      ]),
    );
  }

  // Описание (Markdown)
  const descSection = el("div", { class: "panel-section" });
  descSection.appendChild(
    el("span", { class: "panel-section-label", text: "Описание" }),
  );

  if (task.description && task.description.trim()) {
    descSection.appendChild(
      el("div", {
        class: "markdown-content",
        html: renderMarkdown(task.description),
      }),
    );
  } else {
    descSection.appendChild(
      el("p", { class: "markdown-content-empty", text: "Нет описания" }),
    );
  }
  body.appendChild(descSection);

  // Подзадачи (только если не в корзине)
  if (!isTrash) {
    body.appendChild(renderSubtasksSection(task));
  }

  panel.appendChild(body);

  if (isTrash) {
    const footer = el("div", { class: "task-panel-actions" });
    footer.appendChild(
      el("button", {
        class: "btn btn-secondary",
        text: "Вернуть",
        onclick: async () => {
          await api.restoreTask(task.id);
          toast("Возвращено", "success");
          closeTaskPanel();
          await refreshTasks();
        },
      }),
    );
    footer.appendChild(
      el("button", {
        class: "btn btn-danger",
        text: "Удалить навсегда",
        onclick: async () => {
          const ok = await confirmDialog({
            title: "Удалить навсегда?",
            message: "Нельзя отменить.",
            confirmText: "Удалить",
            danger: true,
          });
          if (!ok) return;
          await api.permanentDeleteTask(task.id);
          toast("Удалено", "success");
          closeTaskPanel();
          await refreshTasks();
        },
      }),
    );
    panel.appendChild(footer);
  }
}


/**
 * Рендерит панель в режиме редактирования (форма).
 *
 * @param {object|null} task - Объект задачи или null для новой.
 * @param {object} defaults - Предустановленные значения.
 */
function renderEditMode(task, defaults) {
  const panel = $("#task-panel");
  const isTrash = Boolean(task?.deleted_at);

  const header = el("div", { class: "task-panel-header" });
  const titleInput = el("input", {
    class: "task-title-input",
    placeholder: "Название задачи",
    value: task?.title || defaults.title || "",
    "aria-label": "Название задачи",
    oninput: markDirty,
  });
  const closeBtn = el(
    "button",
    { class: "icon-btn", "aria-label": "Закрыть", onclick: handlePanelClose },
    [icon("x", 18)],
  );
  header.append(titleInput, closeBtn);
  panel.appendChild(header);

  const body = el("div", { class: "panel-body" });
  const properties = el("div", { class: "panel-properties" });

  // Тип
  const typeSelect = el("select", {
    class: "input",
    "aria-label": "Тип",
    onchange: markDirty,
  });
  typeSelect.appendChild(el("option", { value: "", text: "Без типа" }));
  state.types.forEach((type) =>
    typeSelect.appendChild(
      el("option", {
        value: type.id,
        text: type.name,
        selected: task?.task_type_id === type.id,
      }),
    ),
  );
  properties.appendChild(
    el("div", { class: "panel-property" }, [
      el("span", { class: "panel-property-label", text: "Тип" }),
      typeSelect,
    ]),
  );

  // Приоритет
  const prioritySelect = el("select", {
    class: "input",
    "aria-label": "Приоритет",
    onchange: markDirty,
  });
  Object.entries(PRIORITY_LABELS).forEach(([v, l]) =>
    prioritySelect.appendChild(
      el("option", {
        value: v,
        text: l,
        selected: Number(task?.priority || 2) === Number(v),
      }),
    ),
  );
  properties.appendChild(
    el("div", { class: "panel-property" }, [
      el("span", { class: "panel-property-label", text: "Приоритет" }),
      prioritySelect,
    ]),
  );

  // Статус
  const statusSelect = el("select", {
    class: "input",
    "aria-label": "Статус",
    onchange: markDirty,
  });
  Object.entries(STATUS_LABELS).forEach(([v, l]) =>
    statusSelect.appendChild(
      el("option", {
        value: v,
        text: l,
        selected: (task?.status || defaults.status || "todo") === v,
      }),
    ),
  );
  properties.appendChild(
    el("div", { class: "panel-property" }, [
      el("span", { class: "panel-property-label", text: "Статус" }),
      statusSelect,
    ]),
  );

  // Срок (одиночный или диапазон)
  let timeMode = task?.due_end_at ? "range" : "single";
  const timeSection = el("div", {
    class: "panel-property panel-property-full",
  });
  timeSection.appendChild(
    el("span", { class: "panel-property-label", text: "Срок" }),
  );

  const timeSwitch = el("div", {
    class: "segmented time-mode-switch",
    style: { marginBottom: "8px" },
  });

  const dueInput = el("input", {
    type: "datetime-local",
    class: "input",
    "aria-label": "Начало срока",
    value: task
      ? toDatetimeLocalValue(task.due_at)
      : toDatetimeLocalValue(defaults.dueAt || ""),
    oninput: markDirty,
  });

  const dueEndInput = el("input", {
    type: "datetime-local",
    class: "input",
    "aria-label": "Конец срока",
    value: task ? toDatetimeLocalValue(task.due_end_at) : "",
    oninput: markDirty,
  });

  const singleBtn = el("button", {
    type: "button",
    class: `segmented-button${timeMode === "single" ? " is-active" : ""}`,
    text: "Одно время",
    style: { flex: "1", justifyContent: "center" },
    onclick: () => {
      timeMode = "single";
      dueEndInput.value = "";
      dueEndWrapper.hidden = true;
      singleBtn.classList.add("is-active");
      rangeBtn.classList.remove("is-active");
      markDirty();
    },
  });

  const rangeBtn = el("button", {
    type: "button",
    class: `segmented-button${timeMode === "range" ? " is-active" : ""}`,
    text: "Диапазон",
    style: { flex: "1", justifyContent: "center" },
    onclick: () => {
      timeMode = "range";
      // Автоматически заполняем конец срока, если он пуст
      if (!dueEndInput.value && dueInput.value) {
        const dueDate = parseLocalDate(dueInput.value);
        if (dueDate) {
          dueDate.setHours(dueDate.getHours() + 1);
          dueEndInput.value = toDatetimeLocalValue(dueDate);
        }
      }
      dueEndWrapper.hidden = false;
      rangeBtn.classList.add("is-active");
      singleBtn.classList.remove("is-active");
      markDirty();
    },
  });

  timeSwitch.append(singleBtn, rangeBtn);
  timeSection.appendChild(timeSwitch);

  const timeInputs = el("div", { class: "time-inputs" });
  timeInputs.appendChild(dueInput);
  const dueEndWrapper = el("div", { class: "time-input-end" }, [dueEndInput]);
  if (timeMode === "single") dueEndWrapper.hidden = true;
  timeInputs.appendChild(dueEndWrapper);
  timeSection.appendChild(timeInputs);

  properties.appendChild(timeSection);
  body.appendChild(properties);

  // Описание (Markdown)
  const descSection = el("div", { class: "panel-section" });
  descSection.appendChild(
    el("span", { class: "panel-section-label", text: "Описание" }),
  );

  const descriptionInput = el("textarea", {
    class: "input panel-description",
    placeholder: "Описание задачи (поддерживается Markdown)...",
    text: task?.description || "",
    "aria-label": "Описание",
    oninput: markDirty,
  });

  descSection.appendChild(buildMarkdownToolbar(descriptionInput));
  descSection.appendChild(descriptionInput);
  body.appendChild(descSection);

  // Подзадачи (только для существующих задач не в корзине)
  if (task && !isTrash) {
    body.appendChild(renderSubtasksSection(task));
  }

  panel.appendChild(body);

  if (!isTrash) {
    const footer = el("div", { class: "task-panel-actions" });

    const cancelBtn = el("button", {
      class: "btn btn-secondary",
      text: "Отмена",
      onclick: async () => {
        if (state.panelDirty) {
          const ok = await confirmDialog({
            title: "Несохранённые изменения",
            message: "Есть несохранённые изменения. Отменить?",
            confirmText: "Отменить",
            cancelText: "Продолжить",
          });
          if (!ok) return;
        }
        state.panelDirty = false;
        if (task) {
          switchToView();
        } else {
          closeTaskPanel();
        }
      },
    });

    const saveBtn = el("button", {
      class: "btn btn-primary",
      text: "Сохранить",
      onclick: async () => {
        const title = titleInput.value.trim();
        if (!title) {
          toast("Название обязательно", "error");
          titleInput.focus();
          return;
        }

        const dueAtVal = dueInput.value || null;
        const dueEndVal =
          timeMode === "range" ? dueEndInput.value || null : null;

        if (dueEndVal && !dueAtVal) {
          toast("Укажите начало срока", "error");
          dueInput.focus();
          return;
        }
        if (dueAtVal && dueEndVal) {
          const d1 = parseLocalDate(dueAtVal);
          const d2 = parseLocalDate(dueEndVal);
          if (d1 && d2 && d2 < d1) {
            toast("Конец срока должен быть после начала", "error");
            dueEndInput.focus();
            return;
          }
        }

        const bodyData = {
          title,
          description: descriptionInput.value.trim(),
          taskTypeId: typeSelect.value || null,
          priority: Number(prioritySelect.value),
          status: statusSelect.value,
          dueAt: dueAtVal,
          dueEndAt: dueEndVal,
        };

        try {
          if (task) {
            await api.updateTask(task.id, bodyData);
          } else {
            await api.createTask(state.workspaceId, bodyData);
          }

          toast("Сохранено", "success");
          state.panelDirty = false;
          await refreshTasks();

          // Упрощённая логика: для существующей задачи возвращаемся в просмотр,
          // для новой — закрываем панель, так как editingTaskId был null.
          if (task) {
            switchToView();
          } else {
            closeTaskPanel();
          }
        } catch (err) {
          toast(err.message || "Ошибка сохранения", "error");
        }
      },
    });

    footer.append(cancelBtn, saveBtn);
    panel.appendChild(footer);
  }
}


/**
 * Создаёт DOM-секцию с списком подзадач, прогресс-баром и формой добавления.
 *
 * @param {object} task - Объект родительской задачи.
 * @returns {HTMLElement} Контейнер секции подзадач.
 */
function renderSubtasksSection(task) {
  const section = el("div", { class: "panel-section" });

  // Заголовок секции
  const header = el("div", { class: "panel-subtasks-header" });
  header.appendChild(
    el("span", { class: "subtasks-title", text: "Подзадачи" }),
  );

  if (task.subtasks_total > 0) {
    header.appendChild(
      el("span", {
        class: "subtasks-count",
        text: `${task.subtasks_completed} из ${task.subtasks_total}`,
      }),
    );
  }
  section.appendChild(header);

  // Прогресс-бар (динамический цвет в зависимости от статуса и процента)
  if (task.subtasks_total > 0) {
    const percent = Math.round(
      (task.subtasks_completed / task.subtasks_total) * 100,
    );
    const due = getDueState(task);

    let progressColor = "var(--success)";
    if (percent < 100) {
      if (due.state === "overdue") progressColor = "var(--danger)";
      else if (due.state === "due-soon") progressColor = "var(--warning)";
      else if (percent < 33) progressColor = "var(--danger)";
      else if (percent < 66) progressColor = "var(--warning)";
      else progressColor = "var(--progress-mid)";
    }

    section.appendChild(
      el("div", { class: "subtasks-progress" }, [
        el("div", { class: "progress-info" }, [
          el("span", { text: "Прогресс" }),
          el("span", {
            class: "progress-count",
            text: `${task.subtasks_completed}/${task.subtasks_total}`,
          }),
        ]),
        el("div", { class: "progress-bar" }, [
          el("div", {
            class: "progress-fill",
            style: { width: `${percent}%`, background: progressColor },
          }),
        ]),
      ]),
    );
  }

  // Список подзадач (отсортирован по позиции, затем по дате создания)
  const list = el("div", { class: "subtask-list" });
  const sorted = [...task.subtasks].sort((a, b) => {
    const pa = a.position ?? 0;
    const pb = b.position ?? 0;
    if (pa !== pb) return pa - pb;
    return (
      new Date(a.createdAt || a.created_at || 0) -
      new Date(b.createdAt || b.created_at || 0)
    );
  });

  sorted.forEach((subtask) => {
    list.appendChild(
      el(
        "div",
        { class: `subtask-item${subtask.completed ? " is-done" : ""}` },
        [
          el("input", {
            type: "checkbox",
            class: "checkbox",
            checked: subtask.completed,
            "aria-label": subtask.title,
            onchange: async () => {
              await api.updateSubtask(subtask.id, {
                completed: !subtask.completed,
              });
              await refreshTasks();
            },
          }),
          el("span", { class: "subtask-title", text: subtask.title }),
          el(
            "button",
            {
              class: "icon-btn subtask-delete",
              "aria-label": "Удалить подзадачу",
              onclick: async () => {
                await api.deleteSubtask(subtask.id);
                toast("Подзадача удалена", "success");
                await refreshTasks();
              },
            },
            [icon("x", 12)],
          ),
        ],
      ),
    );
  });
  section.appendChild(list);

  // Форма добавления новой подзадачи
  const input = el("input", {
    class: "input",
    placeholder: "Добавить подзадачу...",
    "aria-label": "Новая подзадача",
  });

  const addButton = el(
    "button",
    {
      class: "btn btn-secondary btn-sm",
      onclick: async () => {
        const title = input.value.trim();
        if (!title) {
          toast("Введите текст подзадачи", "error");
          return;
        }
        await api.createSubtask(task.id, { title });
        input.value = "";
        await refreshTasks();
      },
    },
    [icon("plus", 12)],
  );

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addButton.click();
    }
  });

  section.appendChild(el("div", { class: "subtask-add" }, [input, addButton]));

  return section;
}