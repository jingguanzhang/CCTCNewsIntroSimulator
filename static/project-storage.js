import { EDITOR_STORAGE } from "./text-fields.js";

// Wrap cached values only; the in-memory/exported project remains unchanged.
// Raw project objects from older releases are still accepted as legacy records.
const FORMAT = "motion-studio-project-cache/1";
let lastClock = 0;
let writes = Promise.resolve();
const tabId = Math.random().toString(36).slice(2, 12).padEnd(10, "0");

function unwrap(value) {
  if (!value || typeof value !== "object") return null;
  if (value.format === FORMAT && typeof value.revision === "string") {
    if (!value.project || typeof value.project !== "object") return null;
    return { revision: value.revision, project: value.project };
  }
  return { revision: "", project: value };
}
function revision() {
  // Logical microsecond ticks keep successive saves ordered within one page,
  // even if they happen during the same millisecond or the system clock moves.
  lastClock = Math.max(Date.now() * 1000, lastClock + 1);
  return String(lastClock).padStart(16, "0") + "-" + tabId;
}
function database() {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const r = indexedDB.open("motion-studio-projects", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("projects");
    r.onsuccess = () => (blocked ? r.result.close() : resolve(r.result));
    r.onerror = () => reject(r.error);
    r.onblocked = () => {
      blocked = true;
      reject(new Error("浏览器数据库被其他页面占用"));
    };
  });
}
async function writeIndexedDB(record) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("projects", "readwrite");
      const store = tx.objectStore("projects");
      const get = store.get("latest");
      let conflict = false;
      get.onsuccess = () => {
        const old = unwrap(get.result);
        if (old && old.revision > record.revision) conflict = true;
        else store.put(record, "latest");
      };
      tx.oncomplete = () => resolve(!conflict);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("浏览器数据库保存中断"));
    });
  } finally {
    db.close();
  }
}
export function saveBrowserProject(project) {
  const record = {
    format: FORMAT,
    revision: revision(),
    project: structuredClone(project),
  };
  const run = async () => {
    let local = false,
      indexed = false,
      conflict = false,
      lastError = null;
    try {
      const oldText = localStorage.getItem(EDITOR_STORAGE);
      let old;
      try {
        old = oldText ? unwrap(JSON.parse(oldText)) : null;
      } catch {} // An invalid old record may safely be replaced.
      if (old && old.revision > record.revision) conflict = true;
      else {
        localStorage.setItem(EDITOR_STORAGE, JSON.stringify(record));
        local = true;
      }
    } catch (e) {
      lastError = e;
    }
    try {
      indexed = await writeIndexedDB(record);
      if (!indexed) conflict = true;
    } catch (e) {
      lastError = e;
    }
    if (conflict) throw new Error("其他页面保存了更新的参数，请刷新后再试");
    if (!local && !indexed)
      throw lastError || new Error("浏览器本地存储不可用");
  };
  // Serialize writes in this page, so a slower earlier IndexedDB transaction
  // cannot overwrite a newer save after the user navigates or clicks Save.
  const pending = writes.then(run, run);
  writes = pending.catch(() => {});
  return pending;
}
export async function readBrowserProject() {
  await writes;
  let indexed = null,
    local = null,
    indexedError = null,
    localError = null;
  try {
    const db = await database();
    try {
      indexed = unwrap(
        await new Promise((resolve, reject) => {
          const r = db
            .transaction("projects")
            .objectStore("projects")
            .get("latest");
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        }),
      );
    } finally {
      db.close();
    }
  } catch (e) {
    indexedError = e;
  }
  try {
    const saved = localStorage.getItem(EDITOR_STORAGE);
    if (saved) local = unwrap(JSON.parse(saved));
  } catch (e) {
    localError = e;
  }
  // Legacy data has no revision. Preserve the previous IndexedDB preference
  // for legacy ties, while choosing the newer record for new-format saves.
  const result = !indexed
    ? local
    : !local
      ? indexed
      : local.revision > indexed.revision
        ? local
        : indexed;
  if (!result) {
    if (indexedError || localError) throw indexedError || localError;
    return null;
  }
  if (result.revision) {
    const savedClock = Number(result.revision.split("-")[0]);
    if (Number.isSafeInteger(savedClock))
      lastClock = Math.max(lastClock, savedClock);
  }
  return result.project;
}
