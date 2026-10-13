/**
 * @file Модальное окно настроек приложения.
 * @description Предоставляет интерфейс для управления профилем пользователя,
 *              рабочими пространствами (переключение, переименование, экспорт/импорт),
 *              а также настройками хранилища (переключение режима, очистка данных).
 */

import { el } from "../../core/dom.js";
import { toast, openModal, confirmDialog } from "../../core/ui.js";
import { dateKey } from "../../core/dates.js";
import { state, STORAGE_KEYS } from "../../state/state.js";
import {
  api,
  getStorageMode,
  getStorageStats,
  switchMode,
  clearToken,
} from "../../storage/api.js";
import { loadWorkspaceData } from "../auth.js";
import {
  renderUserInfo,
  renderWorkspaceButton,
} from "../../render/renderLayout.js";
import { renderAll } from "../../app/app.js";
import { closeTaskPanel } from "../taskPanel.js";

/**
 * Открывает модальное окно настроек.
 * Содержит три секции: профиль, рабочее пространство, хранилище.
 *
 * @returns {Promise<void>}
 */
export async function openSettings() {
  let selectedWorkspaceId = state.workspaceId;
  const getSelectedWorkspace = () =>
    state.workspaces.find((w) => w.id === selectedWorkspaceId);

  // --- Профиль ---
  const displayNameInput = el("input", {
    class: "input",
    value: state.user?.displayName || "",
    placeholder: "Отображаемое имя",
    style: { width: "100%" },
  });

  const saveProfileButton = el("button", {
    class: "btn btn-primary btn-sm",
    text: "Сохранить имя",
    onclick: async () => {
      const dn = displayNameInput.value.trim();
      if (!dn) {
        toast("Имя не может быть пустым", "error");
        return;
      }
      try {
        await api.updateProfile({ displayName: dn });
        state.user.displayName = dn;
        renderUserInfo();
        toast("Профиль обновлён", "success");
      } catch (err) {
        toast(err.message, "error");
      }
    },
  });

  // --- Смена пароля ---
  const oldPasswordInput = el("input", {
    class: "input",
    type: "password",
    placeholder: "Текущий пароль",
    autocomplete: "current-password",
    style: { width: "100%" },
  });

  const newPasswordInput = el("input", {
    class: "input",
    type: "password",
    placeholder: "Новый пароль",
    autocomplete: "new-password",
    style: { width: "100%" },
  });

  const changePasswordButton = el("button", {
    class: "btn btn-secondary btn-sm",
    text: "Сменить пароль",
    onclick: async () => {
      try {
        await api.changePassword({
          oldPassword: oldPasswordInput.value,
          newPassword: newPasswordInput.value,
        });
        oldPasswordInput.value = "";
        newPasswordInput.value = "";
        toast("Пароль изменён", "success");
      } catch (err) {
        toast(err.message, "error");
      }
    },
  });

  const passwordGroup = el("div", { class: "settings-password-group" }, [
    oldPasswordInput,
    newPasswordInput,
    changePasswordButton,
  ]);

  // --- Рабочее пространство (комбобокс) ---
  const combobox = el("div", { class: "workspace-combobox" });
  const nameInput = el("input", {
    class: "input workspace-combobox-input",
    value: getSelectedWorkspace()?.name || "",
    placeholder: "Название пространства",
  });

  const toggleBtn = el("button", {
    class: "workspace-combobox-toggle",
    type: "button",
    "aria-label": "Выбрать пространство",
  });
  toggleBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;

  const dropdown = el("div", { class: "workspace-combobox-dropdown" });

  const renderDropdownOptions = () => {
    dropdown.innerHTML = "";
    state.workspaces.forEach((ws) => {
      const option = el("button", {
        class: `workspace-combobox-option${ws.id === selectedWorkspaceId ? " is-active" : ""}`,
        type: "button",
        text: ws.name,
        onclick: (e) => {
          e.stopPropagation();
          selectedWorkspaceId = ws.id;
          nameInput.value = ws.name;
          dropdown.classList.remove("is-open");
          toggleBtn.classList.remove("is-open");
          dropdown
            .querySelectorAll(".workspace-combobox-option")
            .forEach((opt) => {
              opt.classList.remove("is-active");
            });
          option.classList.add("is-active");
        },
      });
      dropdown.appendChild(option);
    });
  };

  renderDropdownOptions();

  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("is-open");
    toggleBtn.classList.toggle("is-open");
  });

  // Закрытие дропдауна при клике вне комбобокса
  const handleOutsideClick = (e) => {
    if (!combobox.contains(e.target)) {
      dropdown.classList.remove("is-open");
      toggleBtn.classList.remove("is-open");
    }
  };
  document.addEventListener("click", handleOutsideClick);

  combobox.append(nameInput, toggleBtn, dropdown);

  const renameWorkspaceButton = el("button", {
    class: "btn btn-secondary btn-sm",
    text: "Переименовать",
    onclick: async () => {
      const name = nameInput.value.trim();
      if (!name) {
        toast("Название обязательно", "error");
        return;
      }
      try {
        const updated = await api.updateWorkspace(selectedWorkspaceId, {
          name,
        });
        state.workspaces = state.workspaces.map((w) =>
          w.id === updated.id ? { ...w, ...updated } : w,
        );
        renderDropdownOptions();
        renderWorkspaceButton();
        toast("Переименовано", "success");
      } catch (err) {
        toast(err.message, "error");
      }
    },
  });

  // --- Экспорт / Импорт ---
  const exportButton = el("button", {
    class: "btn btn-secondary btn-sm",
    text: "Экспорт",
    onclick: async () => {
      try {
        const data = await api.exportWorkspace(selectedWorkspaceId);
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const wsName = getSelectedWorkspace()?.name || "workspace";
        const link = el("a", {
          href: url,
          download: `irsalio-${wsName}-${dateKey(new Date())}.json`,
        });
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        toast("Экспорт начат", "success");
      } catch (err) {
        toast(err.message, "error");
      }
    },
  });

  const fileInput = el("input", {
    type: "file",
    accept: "application/json,.json",
    style: { display: "none" },
  });

  const importButton = el("button", {
    class: "btn btn-secondary btn-sm",
    text: "Импорт",
    onclick: () => fileInput.click(),
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    try {
      const payload = JSON.parse(await file.text());
      const importedWorkspace = await api.importWorkspace(payload);

      const me = await api.me();
      state.workspaces = me.workspaces;
      selectedWorkspaceId = importedWorkspace.id;
      state.workspaceId = importedWorkspace.id;
      localStorage.setItem(STORAGE_KEYS.workspaceId, state.workspaceId);

      state.recordsView = "all";
      state.statusFilter = "";
      state.typeId = "";
      state.search = "";
      closeTaskPanel();

      await loadWorkspaceData();
      renderAll();
      renderDropdownOptions();
      nameInput.value = getSelectedWorkspace()?.name || "";
      toast("Импортировано", "success");
    } catch (err) {
      toast(err.message, "error");
    }
    fileInput.value = "";
  });

  // --- Секция хранилища ---
  const storageSection = await buildStorageSettingsSection();

  // --- Сборка контента модалки ---
  const content = el("div", { class: "settings" }, [
    el("div", { class: "settings-section" }, [
      el("div", { class: "settings-section-title", text: "Профиль" }),
      el("div", { class: "settings-row" }, [
        displayNameInput,
        saveProfileButton,
      ]),
      el("div", { class: "settings-row settings-row-vertical" }, [
        passwordGroup,
      ]),
    ]),
    el("div", { class: "settings-section" }, [
      el("div", {
        class: "settings-section-title",
        text: "Рабочее пространство",
      }),
      el("div", { class: "settings-row settings-row-combobox" }, [
        combobox,
        renameWorkspaceButton,
      ]),
      el("div", { class: "settings-row settings-row-io" }, [
        exportButton,
        importButton,
      ]),
      el("div", {
        class: "settings-note",
        text: "Экспорт сохраняет пространство, типы и записи в JSON.",
      }),
    ]),
    storageSection,
    fileInput,
  ]);

  const modalRef = openModal({ title: "Настройки", content, actions: [] });

  // Гарантированная отписка от глобального слушателя при закрытии модалки
  if (modalRef?.close) {
    const originalClose = modalRef.close;
    modalRef.close = () => {
      document.removeEventListener("click", handleOutsideClick);
      originalClose();
    };
  }

  setTimeout(() => {
    const modal = document.querySelector("#modal-root .modal");
    if (modal) modal.classList.add("modal-wide");
  }, 0);
}

/**
 * Строит секцию настроек хранилища: режим, статистика, действия.
 * Для локального режима использует IndexedDB API, для серверного — данные из state.
 *
 * @returns {Promise<HTMLElement>} DOM-элемент секции.
 */
async function buildStorageSettingsSection() {
  const section = el("div", { class: "settings-section" }, [
    el("div", { class: "settings-section-title", text: "Хранилище" }),
  ]);

  const mode = getStorageMode();

  // Переключатель режима
  const modeRow = el("div", { class: "settings-row settings-row-mode" });
  modeRow.appendChild(
    el("span", {
      text: `Режим: ${mode === "local" ? "Локальное хранение" : "Серверная БД"}`,
    }),
  );
  modeRow.appendChild(
    el("button", {
      class: "btn btn-secondary btn-sm",
      text:
        mode === "local" ? "Переключить на сервер" : "Переключить на локальное",
      onclick: async () => {
        const confirmed = await confirmDialog({
          title: "Переключить режим?",
          message: "Данные не переносятся. Аккаунт сбросится.",
          confirmText: "Переключить",
          danger: true,
        });
        if (confirmed) {
          await switchMode(mode === "local" ? "server" : "local");
          window.location.reload();
        }
      },
    }),
  );
  section.appendChild(modeRow);

  // Статистика использования
  try {
    const stats =
      mode === "server"
        ? {
            counts: {
              tasks: state.tasks.filter((t) => !t.deleted_at).length,
              subtasks: state.tasks.reduce(
                (sum, t) => sum + (t.subtasks_total || 0),
                0,
              ),
              workspaces: state.workspaces.length,
              types: state.types.length,
            },
          }
        : await getStorageStats();

    const usageContainer = el("div", { class: "storage-usage" });

    if (mode === "local") {
      const browserMb = (stats.browserUsage / (1024 * 1024)).toFixed(2);
      const quotaGb = stats.hasQuota
        ? (stats.quota / (1024 * 1024 * 1024)).toFixed(2)
        : null;
      const percent = stats.hasQuota
        ? Math.min(100, (stats.browserUsage / stats.quota) * 100)
        : 0;
      const fillClass =
        percent >= 85 ? "is-danger" : percent >= 60 ? "is-warning" : "";

      usageContainer.appendChild(
        el("div", { class: "storage-usage-header" }, [
          el("span", { class: "storage-usage-value", text: `${browserMb} МБ` }),
          el("span", {
            class: "storage-usage-total",
            text: stats.hasQuota ? `из ${quotaGb} ГБ` : "не ограничено",
          }),
        ]),
      );

      if (stats.hasQuota) {
        usageContainer.appendChild(
          el("div", { class: "storage-usage-bar" }, [
            el("div", {
              class: `storage-usage-fill ${fillClass}`,
              style: { width: `${percent}%` },
            }),
          ]),
        );
      }
    }

    // Количество сущностей
    const details = el("div", { class: "storage-usage-details" });
    const labels = {
      tasks: "Задачи",
      subtasks: "Подзадачи",
      workspaces: "Пространства",
      types: "Типы",
    };
    Object.entries(labels).forEach(([key, label]) => {
      details.appendChild(
        el("div", { class: "storage-usage-stat" }, [
          el("div", { class: "storage-usage-stat-label", text: label }),
          el("div", {
            class: "storage-usage-stat-value",
            text: String(stats.counts[key] || 0),
          }),
        ]),
      );
    });
    usageContainer.appendChild(details);

    // Действия
    const actions = el("div", { class: "storage-usage-actions" });

    actions.appendChild(
      el("button", {
        class: "btn btn-secondary btn-sm",
        text: "Обновить",
        onclick: async (e) => {
          const btn = e.currentTarget;
          const parentSection = btn.closest(".settings-section");
          if (!parentSection) return;

          btn.textContent = "Обновление...";
          btn.disabled = true;
          try {
            const newSection = await buildStorageSettingsSection();
            parentSection.replaceWith(newSection);
          } catch {
            btn.textContent = "Ошибка";
            btn.disabled = false;
            setTimeout(() => {
              btn.textContent = "Обновить";
            }, 1500);
          }
        },
      }),
    );

    actions.appendChild(
      el("button", {
        class: "btn btn-danger btn-sm",
        text: "Очистить данные аккаунта",
        onclick: async () => {
          const isLocal = mode === "local";
          const confirmed = await confirmDialog({
            title: "Очистить данные аккаунта?",
            message: isLocal
              ? "Все пространства, задачи и типы текущего аккаунта будут удалены. Другие аккаунты не пострадают."
              : "Все пространства, задачи и типы текущего аккаунта будут удалены с сервера. Это действие нельзя отменить.",
            confirmText: "Очистить",
            danger: true,
          });
          if (!confirmed) return;

          const workspaces = [...state.workspaces];
          for (const ws of workspaces) {
            try {
              await api.deleteWorkspace(ws.id);
            } catch (e) {
              console.error("Ошибка удаления воркспейса:", e);
            }
          }

          if (isLocal) {
            clearToken();
            localStorage.removeItem(STORAGE_KEYS.workspaceId);
            toast("Данные аккаунта очищены", "success");
            window.location.reload();
          } else {
            toast("Данные аккаунта очищены", "success");
            await loadWorkspaceData();
            renderAll();
            const modal = document.querySelector("#modal-root .modal-overlay");
            if (modal) modal.remove();
          }
        },
      }),
    );

    usageContainer.appendChild(actions);
    section.appendChild(usageContainer);
  } catch {
    section.appendChild(
      el("div", {
        style: { color: "var(--text-faint)", fontSize: "0.82rem" },
        text: "Не удалось получить статистику.",
      }),
    );
  }

  return section;
}
