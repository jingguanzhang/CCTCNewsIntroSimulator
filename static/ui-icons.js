export const icon = (name) => `<i class="ri-${name}" aria-hidden="true"></i>`;
const map = {
  undo: "arrow-go-back-line",
  redo: "arrow-go-forward-line",
  viewToggle: "box-3-line",
  openGenerator: "movie-line",
  helpBtn: "question-line",
  jsonBtn: "code-s-slash-line",
  importBtn: "folder-open-line",
  exportBtn: "save-3-line",
  addText: "text-block",
  addText2d: "text",
  addImage: "image-add-line",
  duplicate: "file-copy-line",
  addKey: "poker-diamonds-line",
  deleteKey: "delete-bin-line",
  prev: "arrow-left-s-line",
  next: "arrow-right-s-line",
  start: "skip-back-line",
  prevKeyframe: "skip-back-mini-line",
  nextKeyframe: "skip-forward-mini-line",
  viewClose: "close-line",
  importProject: "folder-open-line",
  importFont: "font-size",
  export: "movie-line",
  cancel: "close-line",
  download: "save-3-line",
  replaceAudio: "file-music-line",
  resetAudio: "restart-line",
  resetEarthMaterial: "restart-line",
  replaceImage: "image-edit-line",
  projectSettings: "settings-3-line",
  deleteObject: "delete-bin-line",
  removeKey: "delete-bin-line",
  fontBtn: "font-size",
  keyRotation: "poker-diamonds-line",
};
export function decorateIcons(root = document) {
  for (const [id, name] of Object.entries(map)) {
    const el = root.querySelector("#" + id);
    if (!el || el.querySelector("i")) continue;
    let text = el.textContent.replace(/[↶↷↗↓＋◇◆▶Ⅱ▣←→✕]/g, "").trim();
    if (
      [
        "undo",
        "redo",
        "prev",
        "next",
        "start",
        "prevKeyframe",
        "nextKeyframe",
        "viewClose",
      ].includes(id)
    )
      text = "";
    el.innerHTML = icon(name) + (text ? " " + text : "");
    if (!text) el.setAttribute("aria-label", el.title || id);
  }
  for (const el of root.querySelectorAll("[data-pin]")) {
    if (!el.querySelector("i"))
      el.innerHTML =
        icon("poker-diamonds-line") +
        " " +
        el.textContent.replace(/◇/g, "").trim();
  }
  for (const el of root.querySelectorAll("[data-rig-mode]")) {
    if (!el.querySelector("i"))
      el.innerHTML =
        icon(el.dataset.rigMode === "parent" ? "planet-line" : "focus-3-line") +
        " " +
        el.textContent.replace(/[●◇]/g, "").trim();
  }
  for (const el of root.querySelectorAll("[data-close]")) {
    if (!el.querySelector("i") && /[✕×]/.test(el.textContent)) {
      el.innerHTML = icon("close-line");
      el.setAttribute("aria-label", "关闭");
    }
  }
}
