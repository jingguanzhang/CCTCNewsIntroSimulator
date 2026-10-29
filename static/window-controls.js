/**
 * Window Controls & Host Bridge Integration for CCTV News Opening Simulator
 * Handles Minimize, Maximize/Restore, Close, and Header Dragging
 */
(function initWindowControls() {
  function getBridge() {
    return window.HostBridge || window.AppBridge || null;
  }

  function updateMaximizeButton(isMaximized) {
    const maxButtons = document.querySelectorAll(
      '.window-controls [data-window-action="maximize"], .window-controls [data-host-action="toggleMaximize"], .window-controls [data-host-action="maximize"]'
    );
    maxButtons.forEach((btn) => {
      btn.title = isMaximized ? "向下还原" : "最大化";
      btn.setAttribute("aria-label", isMaximized ? "还原" : "最大化");
      const icon = btn.querySelector("i");
      if (icon) {
        if (isMaximized) {
          icon.className = "ri-checkbox-multiple-blank-line";
        } else {
          icon.className = "ri-checkbox-blank-line";
        }
      }
    });
  }

  async function handleAction(action) {
    const bridge = getBridge();
    if (!bridge) {
      console.warn("[WindowControls] HostBridge is not available in browser mode.");
      return;
    }

    try {
      if (action === "minimize") {
        if (bridge.window && typeof bridge.window.minimize === "function") {
          await bridge.window.minimize();
        } else if (typeof bridge.minimize === "function") {
          await bridge.minimize();
        }
      } else if (action === "maximize" || action === "toggleMaximize") {
        let newState;
        if (bridge.window && typeof bridge.window.toggleMaximize === "function") {
          newState = await bridge.window.toggleMaximize();
        } else if (typeof bridge.toggleMaximize === "function") {
          newState = await bridge.toggleMaximize();
        }
        if (newState) {
          updateMaximizeButton(newState === "maximized");
        }
      } else if (action === "close") {
        if (bridge.window && typeof bridge.window.close === "function") {
          await bridge.window.close();
        } else if (typeof bridge.close === "function") {
          await bridge.close();
        }
      }
    } catch (err) {
      console.error("[WindowControls] Action failed:", action, err);
    }
  }

  function bindEvents() {
    // Click delegation for window-controls buttons
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(
        ".window-controls [data-window-action], .window-controls [data-host-action]"
      );
      if (!btn) return;
      const action =
        btn.getAttribute("data-window-action") ||
        btn.getAttribute("data-host-action");
      if (action) {
        e.preventDefault();
        e.stopPropagation();
        handleAction(action);
      }
    });

    // Frameless window dragging support on <header>
    const header = document.querySelector("body > header");
    if (header) {
      header.setAttribute("data-host-drag", "");
      header.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        const interactive = e.target.closest(
          "[data-host-no-drag], button, input, select, textarea, a, label, .window-controls, nav, .header-start, .top-actions"
        );
        if (interactive) return;

        const bridge = getBridge();
        if (bridge) {
          if (bridge.window && typeof bridge.window.drag === "function") {
            bridge.window.drag().catch(() => {});
          } else if (typeof bridge.dragWindow === "function") {
            bridge.dragWindow().catch(() => {});
          }
        }
      });

      header.addEventListener("dblclick", (e) => {
        const interactive = e.target.closest(
          "[data-host-no-drag], button, input, select, textarea, a, label, .window-controls, nav, .header-start, .top-actions"
        );
        if (interactive) return;
        handleAction("toggleMaximize");
      });
    }

    // Subscribe to windowState changes
    const bridge = getBridge();
    if (bridge) {
      if (bridge.events && typeof bridge.events.on === "function") {
        bridge.events.on("windowState", (state) => {
          updateMaximizeButton(state === "maximized");
        });
      } else if (typeof bridge.onWindowStateChange === "function") {
        bridge.onWindowStateChange((state) => {
          updateMaximizeButton(state === "maximized");
        });
      }

      // Initial state sync
      const getState =
        (bridge.window && bridge.window.getState) || bridge.getWindowState;
      if (typeof getState === "function") {
        getState.call(bridge.window || bridge)
          .then((state) => {
            updateMaximizeButton(state === "maximized");
          })
          .catch(() => {});
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindEvents);
  } else {
    bindEvents();
  }
})();
