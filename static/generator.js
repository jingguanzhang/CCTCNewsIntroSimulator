import { readSvgFile } from "./svg-import.js";
import { logoToText } from "./text-fields.js";
import { readBrowserProject, saveBrowserProject } from "./project-storage.js";
import { icon, decorateIcons } from "./ui-icons.js";
import {
  audioSettings,
  readAudioFile,
  syncAudioElement,
  prepareAudioExport,
} from "./audio-track.js";
import { Engine, validate } from "./engine.js";
import { BACKDROP_DEFAULT } from "./background.js";
import { loadRenderAssets } from "./render-assets.js";
import { textFields, applyFields } from "./text-fields.js";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)],
  esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let base,
  project,
  engine,
  time = 0,
  playing = false,
  dirty = true,
  busy = false,
  preset = "1080",
  worker = null,
  blobUrl = null,
  updateTimer,
  valid = true;
const probes = new Map();
let probeId = 0;
let exportCanceled = false;
let ready = false,
  saveTimer = null,
  renderedBlob = null,
  renderedName = "新闻片头.mp4",
  savingVideo = false,
  saveSequence = 0;
function queueSave(p) {
  if (!ready) return;
  clearTimeout(saveTimer);
  const sequence = ++saveSequence;
  $("#cacheStatus").textContent = "正在保存参数…";
  const snapshot = structuredClone(p);
  saveTimer = setTimeout(async () => {
    try {
      await saveBrowserProject(snapshot);
      if (sequence === saveSequence)
        $("#cacheStatus").textContent = "参数已保存到本机";
    } catch (e) {
      if (sequence === saveSequence)
        $("#cacheStatus").textContent = "保存失败：" + e.message;
    }
  }, 350);
}
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("motion-editor-theme", theme);
  } catch {}
  $("#themeToggle").innerHTML = icon(
    theme === "light" ? "moon-line" : "sun-line",
  );
  $("#themeToggle").title = theme === "light" ? "切换暗色" : "切换亮色";
}
$("#themeToggle").onclick = () =>
  setTheme(
    document.documentElement.dataset.theme === "light" ? "dark" : "light",
  );
setTheme(document.documentElement.dataset.theme || "light");

const message = (s = "") => {
  $("#message").hidden = !s;
  $("#message").textContent = s;
};
function renderFields() {
  const fields = textFields(base);
  $("#textFields").innerHTML = fields
    .map((f) => {
      const svg = f.sourceMode === "svg";
      return `<div class="text-field" data-id="${esc(f.id)}" data-mode="${svg ? "svg" : "text"}"><div class="field-heading"><span>${esc(f.label)}</span></div><div class="text-input-row"><input type="text" data-content value="${esc(f.content)}" maxlength="100" aria-label="${esc(f.label)}文字" ${svg ? "hidden" : ""}>${svg ? `<button data-svg-upload class="svg-replace" title="替换 SVG">${esc(f.svgName || "SVG 图形")}</button>` : ""}<button data-source-toggle class="source-toggle" aria-pressed="${svg}" title="${svg ? "切回文字" : "切换到 SVG（文字需先转路径）"}" aria-label="${esc(f.label)}：${svg ? "切回文字" : "切换到 SVG"}">${svg ? "文字" : "SVG"}</button></div><label class="size-row">${svg ? "SVG 高度" : "字号"} · ${f.screen ? "px" : "场景单位"}<input type="number" data-size min="0.05" max="${f.screen ? 500 : 20}" step="0.05" value="${f.size}" aria-label="${esc(f.label)}字号"></label></div>`;
    })
    .join("");
  document.documentElement.style.setProperty(
    "--preview-aspect",
    base.aspect[0] / base.aspect[1],
  );
  $("#background").checked = !!base.scene.backdrop?.enabled;
  $("#templateInfo").textContent =
    `${base.name} · ${base.duration.toFixed(3)} s / ${base.fps} FPS`;
  $("#seek").max = base.duration;
  $("#seek").step = 1 / base.fps;
  $("#previewFrame").style.aspectRatio = base.aspect[0] / base.aspect[1];
  renderAudioTrack();
}
function getFields() {
  return $$(".text-field").map((el) => ({
    id: el.dataset.id,
    content: el.querySelector("[data-content]").value.replace(/[\r\n]/g, " "),
    size: Number(el.querySelector("[data-size]").value),
  }));
}
function apply() {
  clearTimeout(updateTimer);
  try {
    const candidate = applyFields(base, getFields());
    if ($("#background").checked && !candidate.scene.backdrop) {
      candidate.scene.backdrop = structuredClone(BACKDROP_DEFAULT);
      for (const ks of Object.values(candidate.scene.backdrop.tracks))
        for (const k of ks)
          k.time = Math.min(
            candidate.duration,
            (k.time / 18.916666666666668) * candidate.duration,
          );
    }
    if (candidate.scene.backdrop)
      candidate.scene.backdrop.enabled = $("#background").checked;
    validate(candidate);
    engine.load(candidate);
    if (project && JSON.stringify(project) !== JSON.stringify(candidate)) {
      discardResult();
      queueSave(candidate);
    }
    project = candidate;
    renderAudioTrack();
    syncAudio();
    time = Math.min(time, project.duration);
    dirty = true;
    valid = true;
    message();
    return true;
  } catch (e) {
    valid = false;
    message(e.message);
    return false;
  }
}
function setBase(p, { resetTime = false } = {}) {
  validate(p);
  const saved = base;
  base = structuredClone(p);
  try {
    engine.load(p);
    project = p;
    discardResult();
    renderFields();
    time = resetTime ? 0 : Math.min(time, p.duration);
    valid = true;
    dirty = true;
    message();
    resize();
    probe();
    queueSave(project);
  } catch (e) {
    base = saved;
    if (base) renderFields();
    throw e;
  }
}
function resize() {
  if (!engine) return;
  const rect = $("#previewCanvas").getBoundingClientRect();
  if (rect.width && rect.height) {
    engine.renderer.setSize(rect.width, rect.height, false);
    dirty = true;
  }
}
const audio = $("#bgm");
function syncAudio() {
  if (project) syncAudioElement(audio, project, time, playing);
}
function renderAudioTrack() {
  const a = audioSettings(base);
  $("#audioName").textContent = a.name;
  $("#audioRange").textContent = `${a.in.toFixed(2)} – ${a.out.toFixed(2)} s`;
  $("#audioEye").innerHTML = icon(a.enabled ? "eye-line" : "eye-off-line");
  $("#audioEye").title = a.enabled ? "关闭参与输出（静音）" : "开启参与输出";
  $("#audioEye").setAttribute("aria-label", $("#audioEye").title);
  $("#generatorAudioTrack").classList.toggle("muted-track", !a.enabled);
}
$("#audioEye").onclick = () => {
  if (busy) return;
  base.audio = {
    ...audioSettings(base),
    enabled: !audioSettings(base).enabled,
  };
  apply();
  renderAudioTrack();
  syncAudio();
};
$("#replaceAudio").onclick = () => $("#audioFile").click();
$("#resetAudio").onclick = () => {
  if (busy) return;
  delete base.audio;
  apply();
  renderAudioTrack();
  syncAudio();
};
$("#audioFile").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || busy) return;
  play(false);
  try {
    message("正在读取音频…");
    const data = await readAudioFile(file);
    const a = audioSettings(base);
    base.audio = {
      ...a,
      ...data,
      offset: 0,
      out: Math.min(base.duration, a.in + data.duration),
    };
    apply();
    renderAudioTrack();
    syncAudio();
  } catch (err) {
    message(err.message);
  }
};
function play(value) {
  if (busy) return;
  playing = value;
  if (value && time >= project.duration) time = 0;
  $("#play").innerHTML = icon(value ? "pause-fill" : "play-fill");
  syncAudio();
  dirty = true;
}
$("#play").onclick = () => play(!playing);

audio.onloadedmetadata = syncAudio;
$("#seek").oninput = (e) => {
  play(false);
  time = +e.target.value;
  dirty = true;
  syncAudio();
};
$("#textFields").oninput = () => {
  play(false);
  clearTimeout(updateTimer);
  updateTimer = setTimeout(apply, 220);
};
$("#textFields").onchange = apply;
const svgInput = document.createElement("input");
svgInput.type = "file";
svgInput.accept = ".svg,image/svg+xml";
svgInput.hidden = true;
svgInput.id = "generatorSvgInput";
document.body.append(svgInput);
let svgTarget = null,
  svgSequence = 0;
$("#textFields").addEventListener("click", (e) => {
  const b = e.target.closest("[data-source-toggle],[data-svg-upload]");
  if (!b || busy || !apply()) return;
  const id = b.closest(".text-field").dataset.id,
    current = project.objects.find((o) => o.id === id);
  if (
    b.hasAttribute("data-svg-upload") ||
    (current.text?.sourceMode !== "svg" && !current.text?.svg)
  ) {
    svgTarget = { id, base };
    svgInput.click();
    return;
  }
  const next = structuredClone(project),
    o = next.objects.find((o) => o.id === id);
  o.text.sourceMode = o.text.sourceMode === "svg" ? "text" : "svg";
  setBase(next);
});
svgInput.onchange = async (e) => {
  const file = e.target.files[0],
    target = svgTarget,
    sequence = ++svgSequence;
  e.target.value = "";
  if (!file || !target) return;
  try {
    const svg = await readSvgFile(file);
    if (sequence !== svgSequence || target.base !== base || busy || !apply())
      return;
    const next = structuredClone(project),
      o = next.objects.find((o) => o.id === target.id);
    if (!o) return;
    if (o.type === "logo") logoToText(o);
    o.text.svg = svg;
    o.text.sourceMode = "svg";
    setBase(next);
  } catch (e) {
    message(e.message);
  }
};

$("#background").onchange = apply;
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./export-worker.js", import.meta.url), {
    type: "module",
  });
  worker.onmessage = ({ data: d }) => {
    if (d.type === "probe") {
      probes.get(d.id)?.(d);
      probes.delete(d.id);
      return;
    }
    if (d.type === "status") $("#progressLabel").textContent = d.text;
    if (d.type === "started") {
      $("#progressLabel").textContent = `正在渲染 ${d.width} × ${d.height}`;
      $("#progressStats").textContent =
        d.acceleration === "prefer-hardware"
          ? "已请求硬件优先编码（由浏览器调度）"
          : "兼容编码模式（可能使用 CPU）";
    }
    if (d.type === "progress") {
      const percent = d.frame / d.frames;
      $("#progress").value = percent;
      $("#progressLabel").textContent =
        `渲染 ${d.frame} / ${d.frames} 帧 · ${Math.round(percent * 100)}%`;
      $("#progressStats").textContent =
        `已用 ${d.seconds.toFixed(1)} 秒 · 平均 ${(d.frame / Math.max(0.01, d.seconds)).toFixed(1)} 帧/秒`;
      $("#progressEta").textContent =
        percent < 1
          ? "预计剩余 " +
            Math.max(0, d.seconds / percent - d.seconds).toFixed(0) +
            " 秒"
          : "正在完成编码";
    }
    if (d.type === "done") {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      $("#result").hidden = false;
      $("#resultText").textContent =
        `已生成 ${d.width}×${d.height} MP4 · ${d.frames} 帧 · 用时 ${d.seconds.toFixed(1)} 秒`;
      renderedBlob = new Blob([d.buffer], { type: "video/mp4" });
      renderedName = `新闻片头-${d.width}x${d.height}.mp4`;
      blobUrl = URL.createObjectURL(renderedBlob);
      $("#download").hidden = false;
      finish();
      $("#browserDownload").hidden = true;
      $("#saveMessage").textContent = "正在打开保存窗口…";
      if (!$("#saveDialog").open) $("#saveDialog").showModal();
      void saveRenderedVideo(true);
    }
    if (d.type === "error") {
      message(d.message);
      finish();
    }
    if (d.type === "canceled") {
      message("导出已取消，没有生成完整视频。");
      finish();
    }
  };
  worker.onerror = (e) => {
    for (const resolve of probes.values())
      resolve({ ok: false, error: e.message || "后台线程加载失败" });
    probes.clear();
    message(e.message || "后台渲染线程失败，请检查 static 资源");
    if (busy) finish();
  };
  return worker;
}
async function probe() {
  const selected = preset;
  $("#capability").textContent = "正在检测 " + selected + "p H.264 编码能力…";
  $("#export").disabled = true;
  try {
    if (!isSecureContext)
      throw Error(
        "视频导出需要 HTTPS 或 localhost；普通 HTTP 地址无法使用 WebCodecs。",
      );
    if (typeof OffscreenCanvas === "undefined" || typeof Worker === "undefined")
      throw Error("需要支持 OffscreenCanvas 与 Worker 的桌面浏览器");
    const id = ++probeId;
    const result = await new Promise((resolve) => {
      probes.set(id, resolve);
      getWorker().postMessage({
        type: "probe",
        id,
        preset: selected,
        fps: project.fps,
      });
    });
    if (selected !== preset) return;
    if (!result.ok) throw Error(result.error);
    $("#capability").textContent =
      result.config.hardwareAcceleration === "prefer-hardware"
        ? "✓ 此尺寸可编码 · 优先请求硬件加速，实际由浏览器调度"
        : "✓ 此尺寸可编码 · 使用兼容编码模式，可能较慢";
    $("#export").disabled = busy;
  } catch (e) {
    if (selected !== preset) return;
    $("#capability").textContent = e.message;
    $("#export").disabled = true;
  }
}
$$("[data-resolution]").forEach(
  (el) =>
    (el.onclick = () => {
      if (busy) return;
      preset = el.dataset.resolution;
      $$("[data-resolution]").forEach((b) => {
        b.classList.toggle("active", b === el);
        b.setAttribute("aria-pressed", String(b === el));
      });
      probe();
    }),
);
function lock(on) {
  busy = on;
  $$(
    "aside input,aside button,nav button,[data-resolution],#play,#seek,#export,#audioEye,#replaceAudio,#resetAudio",
  ).forEach((e) => (e.disabled = on));
  $("#cancel").disabled = false;
}
function finish() {
  lock(false);
  $("#progressPanel").hidden = true;
  dirty = true;
  worker?.terminate();
  worker = null;
  probe();
}
$("#export").onclick = async () => {
  if (busy || !apply() || !valid) return;
  play(false);
  lock(true);
  exportCanceled = false;
  message();
  discardResult();
  $("#progressPanel").hidden = false;
  $("#progress").value = 0;
  $("#progressLabel").textContent = "准备离屏渲染…";
  $("#progressStats").textContent = "预览已暂停，GPU 优先用于导出";
  $("#progressEta").textContent = "";
  try {
    $("#progressLabel").textContent = "准备音轨…";
    const audioData = await prepareAudioExport(project);
    if (exportCanceled) {
      message("导出已取消");
      finish();
      return;
    }
    getWorker().postMessage(
      {
        type: "start",
        project: structuredClone(project),
        preset,
        audioData,
        fullBackground: $("#fullBackground").checked,
      },
      audioData ? audioData.planes.map((plane) => plane.buffer) : [],
    );
  } catch (e) {
    message(e.message);
    finish();
  }
};
$("#cancel").onclick = () => {
  exportCanceled = true;
  worker?.postMessage({ type: "cancel" });
  $("#progressLabel").textContent = "正在取消并释放资源…";
  $("#cancel").disabled = true;
};
function discardResult() {
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = null;
  renderedBlob = null;
  $("#result").hidden = true;
}
function browserDownload() {
  if (!blobUrl || !renderedBlob) return;
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = renderedName;
  a.click();
  $("#resultText").textContent = "已交给浏览器下载";
  if ($("#saveDialog").open) $("#saveDialog").close();
}
async function saveRenderedVideo(automatic = false) {
  if (!renderedBlob || savingVideo) return;
  const blob = renderedBlob,
    name = renderedName;
  if (!window.showSaveFilePicker) {
    $("#saveMessage").textContent = "点击保存视频，由浏览器下载文件。";
    if (!automatic) browserDownload();
    return;
  }
  savingVideo = true;
  $("#saveVideo").disabled = true;
  let writable;
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: name,
      types: [{ description: "MP4 视频", accept: { "video/mp4": [".mp4"] } }],
    });
    writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    writable = null;
    $("#resultText").textContent = "视频已保存";
    $("#saveDialog").close();
  } catch (e) {
    try {
      await writable?.abort();
    } catch {}
    $("#saveMessage").textContent =
      e.name === "AbortError"
        ? "已取消保存，视频仍可再次保存。"
        : automatic
          ? "视频已就绪。请点击“保存视频”选择保存位置。"
          : "系统保存窗口不可用：" + e.message + "。可以重试或使用浏览器下载。";
    $("#browserDownload").hidden = automatic || e.name === "AbortError";
  } finally {
    savingVideo = false;
    $("#saveVideo").disabled = false;
  }
}
$("#saveVideo").onclick = () => saveRenderedVideo(false);
$("#browserDownload").onclick = browserDownload;
$("#download").onclick = () => {
  $("#browserDownload").hidden = true;
  $("#saveMessage").textContent = "正在打开保存窗口…";
  if (!$("#saveDialog").open) $("#saveDialog").showModal();
  void saveRenderedVideo(false);
};
$("#closeSaveDialog").onclick = () => $("#saveDialog").close();
$("#advancedEditor").onclick = async () => {
  if (busy || !apply()) return;
  clearTimeout(saveTimer);
  ++saveSequence;
  try {
    await saveBrowserProject(project);
    location.href = "editor.html";
  } catch (e) {
    message("参数保存失败，暂未进入高级编辑：" + e.message);
  }
};
window.addEventListener("beforeunload", (e) => {
  if (busy) {
    e.preventDefault();
    e.returnValue = "正在导出视频";
  }
});
$("#importProject").onclick = () => $("#projectFile").click();
$("#projectFile").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    if (f.size > 40000000) throw Error("工程 JSON 不得超过 40 MB");
    play(false);
    setBase(JSON.parse(await f.text()), { resetTime: true });
  } catch (error) {
    message(error.message);
  }
  e.target.value = "";
};
$("#importFont").onclick = () => $("#fontFile").click();
$("#fontFile").onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > 20000000) return message("字体文件不得超过 20 MB");
  const r = new FileReader();
  r.onload = () => {
    const old = base.fontData;
    base.fontData = r.result;
    if (!apply()) base.fontData = old;
  };
  r.readAsDataURL(f);
  e.target.value = "";
};
async function initialProject() {
  let failed = false;
  try {
    const saved = await readBrowserProject();
    if (saved) {
      validate(saved);
      return { project: saved, source: "已加载本机参数" };
    }
  } catch {
    failed = true;
  }
  const r = await fetch(new URL("./default-project.json", import.meta.url));
  if (!r.ok) throw Error("默认参数加载失败");
  return {
    project: await r.json(),
    source: failed ? "本机参数不可用，已加载默认参数" : "已加载默认参数",
  };
}
const [assets, initial] = await Promise.all([
  loadRenderAssets(),
  initialProject(),
]);
engine = new Engine($("#previewCanvas"), {
  ...assets,
  interactive: false,
  pixelRatio: Math.min(devicePixelRatio, 1.25),
});
engine.onAssetsReady = () => (dirty = true);
engine.onAssetError = (e) => message("图片解码失败：" + e.message);
setBase(initial.project);
ready = true;
$("#cacheStatus").textContent = initial.source;
$("#restoreDefault").onclick = async () => {
  if (busy || !confirm("恢复默认参数？当前本机参数将被替换。")) return;
  try {
    const r = await fetch(new URL("./default-project.json", import.meta.url));
    if (!r.ok) throw Error("默认参数加载失败");
    play(false);
    setBase(await r.json(), { resetTime: true });
  } catch (e) {
    message(e.message);
  }
};
$("#loading").hidden = true;
new ResizeObserver(resize).observe($("#previewFrame"));
resize();
let last = performance.now(),
  lastDraw = 0,
  lastAudio = 0;
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!busy) {
    if (playing) {
      time += dt;
      if (time >= project.duration) {
        time = project.duration;
        play(false);
      }
      dirty = true;
      if (now - lastAudio > 300) {
        lastAudio = now;
        syncAudio();
      }
    }
    if (dirty && now - lastDraw > 1000 / 30) {
      engine.render(project, time);
      $("#seek").value = time;
      $("#timecode").textContent =
        `${time.toFixed(3)} / ${project.duration.toFixed(3)} s`;
      lastDraw = now;
      dirty = false;
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
decorateIcons();
$("#play").innerHTML = icon("play-fill");
window.videoGenerator = {
  getProject: () => structuredClone(project),
  setProject: setBase,
  seek: (t) => {
    play(false);
    time = Math.max(0, Math.min(project.duration, t));
    dirty = true;
    syncAudio();
  },
  getEngine: () => engine,
  isExporting: () => busy,
};
