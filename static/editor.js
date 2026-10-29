import { earthMaterial } from "./earth-material.js";
import { readSvgFile } from "./svg-import.js";
import { saveBrowserProject, readBrowserProject } from "./project-storage.js";
import { icon, decorateIcons } from "./ui-icons.js";
import {
  audioSettings,
  DEFAULT_AUDIO_URL,
  readAudioFile,
  decodeTrack,
  syncAudioElement,
} from "./audio-track.js";
import { isScreen } from "./appearance.js";
import { logoToText } from "./text-fields.js";
import { Workbench } from "./workbench.js";
import { setupPreviewViewport } from "./preview-viewport.js";
import flipExample from "./examples/bottom-flip.js";
import orbitExample from "./examples/orbit-self-spin.js";
import { BACKDROP_DEFAULT } from "./background.js";
async function resource(path, type) {
  const r = await fetch(new URL(path, import.meta.url));
  if (!r.ok) throw Error("资源加载失败：" + path + " (" + r.status + ")");
  return type === "json" ? r.json() : r.arrayBuffer();
}
const [initial, fontBuffer] = await Promise.all([
  resource("./default-project.json", "json"),
  resource("./editor-font.otf", "buffer"),
]);
window.DEFAULT_FONT_BUFFER = fontBuffer;
window.EARTH = new URL("./earth.jpg", import.meta.url).href;
window.CLOUD = new URL("./earthCloud.png", import.meta.url).href;
window.RIBBON_IMAGES = Object.fromEntries(
  [
    ["red", "r"],
    ["green", "g"],
    ["blue", "b"],
  ].map(([name, c]) => [
    name,
    new URL("./rgb-" + c + ".png", import.meta.url).href,
  ]),
);
await Promise.all(
  [window.EARTH, window.CLOUD, ...Object.values(window.RIBBON_IMAGES)].map(
    (url) =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = resolve;
        image.onerror = () => reject(Error("图片加载失败：" + url));
        image.src = url;
      }),
  ),
);
import * as THREE from "./vendor/three/three.module.js";
import {
  Engine,
  CHANNELS as SCALAR_CHANNELS,
  QUAT_CHANNELS,
  sampleQuaternion,
  EASINGS,
  migrate,
  values,
  sample,
  validate,
  clamp,
} from "./engine.js";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)],
  clone = (o) => structuredClone(o),
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
const BG_CHANNELS = {
  intensity: "光照强度",
  rotation: "光束角度",
  travel: "流动进度",
  centerX: "中心 X",
  centerY: "中心 Y",
  particles: "粒子强度",
};
const CHANNELS = { ...SCALAR_CHANNELS, ...BG_CHANNELS, ...QUAT_CHANNELS };
const isQuat = (ch) =>
  selected !== "__background__" && Object.hasOwn(QUAT_CHANNELS, ch);
let project = migrate(clone(initial)),
  selected = null,
  channel = "rotation",
  selectedKey = null,
  keyNavigationScope = "element",
  time = 0,
  playing = false,
  rate = 1,
  solo = false,
  undoStack = [],
  redoStack = [],
  expanded = new Set(),
  pps = 45,
  labelWidth = 206,
  toastTimer,
  saveTimer,
  saveSequence = 0,
  dragging = false;
let transformMode = "self",
  keepPose = true,
  gizmoEnabled = true,
  gizmoSpace = "local",
  gizmoSnap = 0,
  gizmoSession = null,
  screenGesture = null,
  suppressCanvasClickUntil = 0,
  rotationPointerUsed = false,
  activeViewport = "edit",
  editViewOpen = true;
let viewWidth = 420,
  viewPathVisible = true,
  inspectorOpen = true,
  timelineHeight = 330;
try {
  const ui = JSON.parse(localStorage.getItem("motion-workbench-ui") || "{}");
  editViewOpen = ui.open !== false;
  viewWidth = Number(ui.width) || 420;
  viewPathVisible = ui.path !== false;
  inspectorOpen = ui.inspectorOpen !== false;
  if (
    Number.isFinite(Number(ui.timelineHeight)) &&
    Number(ui.timelineHeight) > 0
  )
    timelineHeight = Number(ui.timelineHeight);
} catch (_) {}
const engine = new Engine($("#canvas")),
  video = $("#reference"),
  workbench = new Workbench(engine, $("#editCanvas"));
const previewViewport = setupPreviewViewport({
  space: $("#previewSpace"),
  grid: $("#stageGrid"),
  canvas: $("#canvas"),
  renderer: engine.renderer,
  reset: $("#previewReset"),
  isBusy: () => !!(gizmoSession || screenGesture),
});
let initNotice = "";
workbench.pathVisible = viewPathVisible;
try {
  const saved = await readBrowserProject();
  if (saved) {
    project = validate(saved);
    initNotice = "已恢复浏览器中的上次编辑";
  }
} catch (e) {
  initNotice = "自动恢复不可用，已载入初始工程";
  project = migrate(clone(initial));
}
try {
  engine.load(project);
} catch (e) {
  project = migrate(clone(initial));
  engine.load(project);
  initNotice = "存储的工程无法载入，已恢复初始配置：" + e.message;
}
selected = findObject(selected)?.id || null;
time = Math.min(time, project.duration);
const presetIds = new Set(initial.objects.map((o) => o.id));
const protectedObject = (o) =>
  o.type === "camera" || o.type === "background" || presetIds.has(o.id);
const fallbackBackgrounds = new WeakMap();
function backgroundLayer() {
  let b = project.scene.backdrop;
  if (!b) {
    b = fallbackBackgrounds.get(project);
    if (!b) {
      b = { ...freshBackdrop(), enabled: false };
      fallbackBackgrounds.set(project, b);
    }
  }
  const attach = () => (project.scene.backdrop = b);
  return {
    id: "__background__",
    name: "背景",
    type: "background",
    get enabled() {
      return b.enabled;
    },
    set enabled(v) {
      attach();
      b.enabled = v;
    },
    get in() {
      return b.in ?? 0;
    },
    set in(v) {
      attach();
      b.in = v;
    },
    get out() {
      return b.out ?? project.duration;
    },
    set out(v) {
      attach();
      b.out = v;
    },
    base: b.base,
    tracks: b.tracks,
    colors: b.colors,
  };
}
const projectLayer = () => ({
  id: "__project__",
  type: "project",
  name: project.name,
  base: {},
  tracks: {},
  in: 0,
  out: project.duration,
  enabled: true,
});
function ensureAudio() {
  return (project.audio ??= audioSettings(project));
}
function audioLayer() {
  return {
    id: "__audio__",
    type: "audio",
    get name() {
      return audioSettings(project).name;
    },
    get enabled() {
      return audioSettings(project).enabled;
    },
    set enabled(v) {
      ensureAudio().enabled = v;
    },
    get in() {
      return audioSettings(project).in;
    },
    set in(v) {
      ensureAudio().in = v;
    },
    get out() {
      return audioSettings(project).out;
    },
    set out(v) {
      ensureAudio().out = v;
    },
    base: {},
    tracks: {},
  };
}
let audioWaveKey = "",
  audioWave = null;
function updateAudioWave() {
  const src = audioSettings(project).src || DEFAULT_AUDIO_URL;
  if (src === audioWaveKey) return;
  audioWaveKey = src;
  audioWave = null;
  decodeTrack(src)
    .then((info) => {
      if (src === audioWaveKey) {
        audioWave = info;
        renderTimeline();
      }
    })
    .catch(() => {});
}
function audioWaveMarkup(o) {
  if (!audioWave)
    return `<span class="audio-clip-label">${icon("music-2-line")} ${esc(o.name)}</span>`;
  const a = audioSettings(project),
    start = a.offset / audioWave.duration,
    end = (a.offset + o.out - o.in) / audioWave.duration,
    points = [];
  for (let i = 0; i < 160; i++) {
    const pos = start + ((end - start) * i) / 159,
      p =
        pos >= 0 && pos < 1
          ? audioWave.peaks[Math.floor(pos * 128)] /
            Math.max(0.001, ...audioWave.peaks)
          : 0;
    points.push(`${i * 4},${12 - p * 10} ${i * 4},${12 + p * 10}`);
  }
  return `<svg class="audio-wave" viewBox="0 0 636 24" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points.join(" ")}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
}
function outputToggle(enabled) {
  return `<label class="output-toggle" title="同时控制预览和最终视频输出"><span>参与输出</span><input id="layerEnabled" type="checkbox" role="switch" aria-label="参与输出" ${enabled ? "checked" : ""}></label>`;
}
function renderAudioInspector() {
  const a = audioSettings(project);
  $("#inspectorState").textContent = "音轨";
  $("#inspector").innerHTML =
    `<div class="selection-title"><div class="icon-large">${icon("music-2-line")}</div><strong>${esc(a.name)}</strong></div>${field("名称", `<input data-field="audio.name" value="${esc(a.name)}" maxlength="120">`)}${outputToggle(a.enabled)}<div class="form-section"><h3>时间范围</h3>${field("入点 / 秒", number("audio.in", a.in, ".01", 0, project.duration))}${field("出点 / 秒", number("audio.out", a.out, ".01", 0.001, project.duration))}</div><div class="form-section"><h3>音频素材</h3><div class="asset-actions"><button id="replaceAudio">替换音频</button><button id="resetAudio">恢复默认</button></div><p class="coordinate-note">MP3 / WAV / M4A 等浏览器可解码格式，最大 20 MB。关闭“参与输出”将同时静音预览和视频导出。</p></div><div class="form-section"><h3>音频参数</h3>${field("源文件偏移 / 秒", number("audio.offset", a.offset, ".01", 0, 600))}${field("音量 / %", number("audio.volume", a.volume * 100, "1", 0, 100))}</div>`;
  organizeInspector();
  decorateIcons();
}
function renderProjectInspector() {
  const p = project;
  $("#inspectorState").textContent = "工程";
  $("#inspector").innerHTML =
    `<div class="selection-title"><div class="icon-large">${icon("settings-3-line")}</div><strong>工程属性</strong></div><p class="coordinate-note">点击时间轴图层或画面元素编辑。点击空白画面、工程按钮或按 Esc 返回这里。</p><div class="form-section"><h3>工程设置</h3>${field("名称", `<input data-field="project.name" value="${esc(p.name)}">`)}${field("总时长 / 秒", number("project.duration", p.duration, ".01", 0.1, 300))}${field("帧率", number("project.fps", p.fps, "1", 1, 120))}${field("画幅宽", number("project.aspectX", p.aspect[0], "1", 1, 100))}${field("画幅高", number("project.aspectY", p.aspect[1], "1", 1, 100))}${field("曝光", number("project.exposure", p.scene.exposure, ".05", 0.1, 5))}</div><div class="form-section"><h3>工程信息</h3><div class="project-facts"><span>画面元素</span><b>${p.objects.length}</b><span>音轨</span><b>${audioSettings(p).enabled ? "开启" : "关闭"}</b><span>显示比例</span><b>${p.aspect.join(" : ")}</b></div></div>`;
  organizeInspector();
  decorateIcons();
}
function editProjectField(key, value) {
  commit(() => {
    if (key === "name") {
      project.name = value;
      return;
    }
    if (key === "duration") {
      const old = project.duration;
      project.duration = value;
      for (const o of project.objects)
        if (Math.abs(o.out - old) < 1e-5) o.out = value;
      if (
        project.scene.backdrop?.out !== undefined &&
        Math.abs(project.scene.backdrop.out - old) < 1e-5
      )
        project.scene.backdrop.out = value;
      if (project.audio && Math.abs(project.audio.out - old) < 1e-5)
        project.audio.out = value;
      time = Math.min(time, value);
    } else if (key === "fps") project.fps = value;
    else if (key === "aspectX") project.aspect[0] = value;
    else if (key === "aspectY") project.aspect[1] = value;
    else if (key === "exposure") project.scene.exposure = value;
  }, true);
}
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  workbench.renderer.setClearColor(theme === "light" ? 0xe6ebf1 : 0x171d25, 1);
  workbench.grid.material.transparent = true;
  workbench.grid.material.opacity = theme === "light" ? 0.35 : 1;
  workbench.pathLine.material.color.set(
    theme === "light" ? "#3975a3" : "#7bc8ef",
  );
  try {
    localStorage.setItem("motion-editor-theme", theme);
  } catch {}
  const b = $("#themeToggle");
  if (b) {
    b.innerHTML = icon(theme === "light" ? "moon-line" : "sun-line");
    b.title = theme === "light" ? "切换暗色主题" : "切换亮色主题";
    b.setAttribute("aria-label", b.title);
    b.setAttribute("aria-pressed", String(theme === "light"));
  }
}

const layers = () => [
  ...project.objects.filter((o) => !presetIds.has(o.id)).reverse(),
  ...project.objects.filter((o) => presetIds.has(o.id)),
  backgroundLayer(),
  audioLayer(),
];
function findObject(id) {
  if (id === "__audio__") return audioLayer();
  return id === "__background__"
    ? backgroundLayer()
    : project.objects.find((o) => o.id === id);
}
const object = () => findObject(selected) || projectLayer();
const channelEntries = (o) =>
  ["project", "audio"].includes(o.type)
    ? []
    : o.type === "background"
      ? Object.entries(BG_CHANNELS)
      : Object.entries({ ...SCALAR_CHANNELS, ...QUAT_CHANNELS }).filter(
          ([c]) =>
            isScreen(o)
              ? ["x", "y", "sx", "sy", "rz", "opacity"].includes(c)
              : o.type === "camera"
                ? ["x", "y", "z", "rx", "ry", "rz"].includes(c)
                : ![
                    "rx",
                    "ry",
                    "rz",
                    "normalSpin",
                    "grx",
                    "gry",
                    "grz",
                  ].includes(c) &&
                  (c !== "reveal" || o.type === "text"),
        );
const activeKey = () =>
  selectedKey
    ? findObject(selectedKey.id)?.tracks[selectedKey.channel]?.find(
        (k) => Math.abs(k.time - selectedKey.time) < 1e-7,
      )
    : null;
const round = (v) => Math.round(v * 1000000) / 1000000;
function toast(msg, error = false) {
  clearTimeout(toastTimer);
  $("#toast").textContent = msg;
  $("#toast").classList.toggle("error", error);
  $("#toast").hidden = false;
  toastTimer = setTimeout(
    () => ($("#toast").hidden = true),
    error ? 6500 : 3200,
  );
}
function persist() {
  clearTimeout(saveTimer);
  const sequence = ++saveSequence;
  $("#saveStatus").textContent = "有未保存更改";
  saveTimer = setTimeout(async () => {
    try {
      await saveBrowserProject(project);
      if (sequence === saveSequence)
        $("#saveStatus").textContent = "已保存到浏览器";
    } catch (e) {
      if (sequence === saveSequence)
        $("#saveStatus").textContent = "保存失败：" + e.message;
    }
  }, 350);
}
function history(snapshot) {
  undoStack.push(snapshot);
  let n = undoStack.reduce((a, s) => a + s.length, 0);
  while (undoStack.length > 50 || (n > 25000000 && undoStack.length > 1))
    n -= undoStack.shift().length;
  redoStack = [];
  persist();
}
function commit(fn, rebuild = false) {
  const before = JSON.stringify(project);
  try {
    if (selected === "__background__" && !project.scene.backdrop) {
      const bg = backgroundLayer();
      bg.enabled = bg.enabled;
    }
    fn();
    validate(project);
    if (rebuild === true) engine.load(project);
    else if (typeof rebuild === "string")
      engine.rebuild(project.objects.find((o) => o.id === rebuild));
    if (JSON.stringify(project) !== before) history(before);
    refresh();
    return true;
  } catch (e) {
    project = JSON.parse(before);
    try {
      engine.load(project);
    } catch (_) {}
    refresh();
    toast(e.message, true);
    return false;
  }
}
function restore(stack, other) {
  if (!stack.length) return;
  playing = false;
  other.push(JSON.stringify(project));
  project = JSON.parse(stack.pop());
  engine.load(project);
  selected = findObject(selected)?.id || null;
  selectedKey = null;
  time = Math.min(time, project.duration);
  persist();
  refresh();
  syncVideo();
}
function select(id, { seek = false } = {}) {
  keyNavigationScope = "element";
  selected = id;
  selectedKey = null;
  solo = false;
  let o = object();
  if (!channelEntries(o).some(([c]) => c === channel))
    channel = channelEntries(o)[0]?.[0] || "";
  if (seek && (time < o.in || time > o.out))
    setTime(Math.min(o.out, o.in + 0.5));
  refresh();
}
function setTime(t, { snap = false } = {}) {
  if (gizmoSession) return;
  time = clamp(
    snap && $("#snap").checked ? Math.round(t * project.fps) / project.fps : t,
    0,
    project.duration,
  );
  syncVideo();
  frame();
}
function syncMusic() {
  syncAudioElement($("#editorBgm"), project, time, playing, rate);
}
function syncVideo() {
  syncMusic();
  if (video.readyState && Number.isFinite(video.duration)) {
    let target = Math.min(time, Math.max(0, video.duration - 0.01));
    if (Math.abs(video.currentTime - target) > 0.015)
      video.currentTime = target;
  }
}
function play(v) {
  playing = v;
  syncMusic();
  $("#play").innerHTML =
    icon(playing ? "pause-fill" : "play-fill") + (playing ? " 暂停" : " 播放");
  if (playing && referenceEnabled() && time < video.duration) {
    video.playbackRate = rate;
    syncVideo();
    video.play().catch(() => {});
  } else video.pause();
}
function addKey(id = selected, ch = channel, t = time, val) {
  const o = findObject(id);
  if (!o || !channelEntries(o).length) return;
  t = clamp(round(t), 0, project.duration);
  const v =
    val ??
    (isQuat(ch)
      ? engine.rotation(o, ch, t).toArray()
      : sample(o.tracks[ch], t, o.base[ch]));
  let keys = (o.tracks[ch] ??= []);
  let k = keys.find((k) => Math.abs(k.time - t) < 0.00001);
  if (k)
    k.value = Array.isArray(v)
      ? new THREE.Quaternion()
          .fromArray(v)
          .normalize()
          .toArray()
          .map((v) => (v === 0 ? 0 : v))
      : v;
  else {
    keys.push({
      time: t,
      value: Array.isArray(v)
        ? new THREE.Quaternion()
            .fromArray(v)
            .normalize()
            .toArray()
            .map((v) => (v === 0 ? 0 : v))
        : round(v),
      easing: "linear",
    });
    keys.sort((a, b) => a.time - b.time);
  }
  selectedKey = { id, channel: ch, time: t };
  keyNavigationScope = "channel";
  channel = ch;
}
function keyTimes(scope = "element") {
  const o = object();
  return [
    ...new Set(
      (scope === "channel"
        ? o.tracks[channel] || []
        : Object.values(o.tracks).flat()
      ).map((k) => k.time),
    ),
  ].sort((a, b) => a - b);
}
function neighborKey(dir, scope = keyNavigationScope) {
  const ts = keyTimes(scope);
  return dir < 0
    ? [...ts].reverse().find((t) => t < time - 1e-7)
    : ts.find((t) => t > time + 1e-7);
}
function updateKeyNavigation() {
  for (const [id, dir] of [
    ["prevKeyframe", -1],
    ["nextKeyframe", 1],
  ]) {
    let next = neighborKey(dir);
    const b = $("#" + id);
    b.disabled = next === undefined;
    b.title =
      (dir < 0 ? "上一" : "下一") +
      (keyNavigationScope === "channel"
        ? "关键帧 · 当前通道"
        : "关键帧 · 当前元素全部通道") +
      (next === undefined
        ? "（没有更多关键帧）"
        : " · " + next.toFixed(3) + " 秒");
  }
}
function revealTime() {
  const el = $("#timelineScroll"),
    x = time * pps,
    w = el.clientWidth - labelWidth;
  if (x < el.scrollLeft + 12) el.scrollLeft = Math.max(0, x - 30);
  else if (x > el.scrollLeft + w - 20) el.scrollLeft = x - w + 40;
  updatePlayhead();
}
function jumpKey(dir, scope = keyNavigationScope) {
  const t = neighborKey(dir, scope);
  if (t === undefined) return;
  play(false);
  const o = object();
  if (!(o.tracks[channel] || []).some((k) => Math.abs(k.time - t) < 1e-7))
    channel = Object.keys(o.tracks).find((c) =>
      o.tracks[c].some((k) => Math.abs(k.time - t) < 1e-7),
    );
  selectedKey = {
    id: selected,
    channel,
    time: t,
    aggregate: scope === "element",
  };
  transformMode = channel.startsWith("g") ? "parent" : "self";
  setTime(t);
  refresh();
  revealTime();
}
function zoomTimeline(value, clientX) {
  const el = $("#timelineScroll"),
    left = el.getBoundingClientRect().left;
  let x =
    clientX === undefined
      ? labelWidth + (el.clientWidth - labelWidth) / 2
      : clamp(clientX - left, labelWidth, el.clientWidth);
  const anchor = (el.scrollLeft + x - labelWidth) / pps;
  $("#zoom").value = clamp(
    value,
    Number($("#zoom").min),
    Number($("#zoom").max),
  );
  renderTimeline();
  el.scrollLeft = anchor * pps - (x - labelWidth);
  updatePlayhead();
  $("#zoom").title = Number($("#zoom").value).toFixed(2) + "×";
}
function selectionEntries() {
  if (!selectedKey) return [];
  const o = findObject(selectedKey.id);
  if (!o) return [];
  return Object.entries(o.tracks).flatMap(([c, ks]) =>
    selectedKey.aggregate || c === selectedKey.channel
      ? ks
          .filter((k) => Math.abs(k.time - selectedKey.time) < 1e-7)
          .map((k) => ({ channel: c, key: k }))
      : [],
  );
}
function deleteSelectedKey() {
  const entries = selectionEntries();
  if (!entries.length) return toast("请先选中一个菱形关键帧");
  play(false);
  let count = entries.length;
  const ok = commit(() => {
    let o = findObject(selectedKey.id);
    for (let entry of entries) {
      o.tracks[entry.channel] = o.tracks[entry.channel].filter(
        (k) => k !== entry.key,
      );
      if (!o.tracks[entry.channel].length) delete o.tracks[entry.channel];
    }
    selectedKey = null;
  });
  if (ok) toast(`已删除 ${count} 个通道关键帧 · 可撤销`);
}
const LINK_GROUPS = {
  position: ["x", "y", "z"],
  rotation: ["rx", "ry", "rz"],
  scale: ["sx", "sy", "sz"],
  groupPosition: ["gx", "gy", "gz"],
  groupRotation: ["grx", "gry", "grz"],
  groupScale: ["gsx", "gsy", "gsz"],
};
const groupFor = (ch) =>
  Object.keys(LINK_GROUPS).find((g) => LINK_GROUPS[g].includes(ch));
const lockButton = (o, g) =>
  `<button type="button" class="ratio-lock ${o.links?.[g] ? "locked" : ""}" data-lock="${g}" aria-label="${g} 比例联动" aria-pressed="${!!o.links?.[g]}" title="${o.links?.[g] ? "已锁定比例：修改一轴，XYZ 按比例联动；原值为零时等量增减。点击解除。" : "比例未锁定：点击联动这一组 XYZ。"}">${icon(o.links?.[g] ? "lock-line" : "lock-unlock-line")}</button>`;
function linkedValues(old, i, value) {
  if (Math.abs(old[i]) < 1e-9)
    return old.map((v, j) => (j === i ? value : v + value - old[i]));
  let ratio = value / old[i];
  return old.map((v, j) => (j === i ? value : v * ratio));
}
function editMotion(ch, value, t = time) {
  const o = object(),
    g = groupFor(ch),
    ks = g && o.links?.[g] ? LINK_GROUPS[g] : [ch],
    v = values(o, t),
    result =
      ks.length > 1
        ? linkedValues(
            ks.map((k) => v[k]),
            ks.indexOf(ch),
            value,
          )
        : [value];
  const existing = Object.fromEntries(
    ks.map((k) => [
      k,
      o.tracks[k]?.find((x) => Math.abs(x.time - t) < 1e-5)?.easing,
    ]),
  );
  ks.forEach((k, i) => {
    addKey(o.id, k, t, result[i]);
    if (existing[k])
      o.tracks[k].find((x) => Math.abs(x.time - t) < 1e-5).easing = existing[k];
  });
  channel = ch;
  selectedKey = {
    id: o.id,
    channel: ch,
    time: clamp(round(t), 0, project.duration),
    aggregate: false,
  };
}

function renderObjects() {
  return;
  $("#objectCount").textContent = String(project.objects.length).padStart(
    2,
    "0",
  );
  $("#objectList").innerHTML = project.objects
    .map(
      (o) =>
        `<div class="object ${o.id === selected ? "selected" : ""} ${o.enabled ? "" : "inactive"}" data-object="${esc(o.id)}"><span class="obj-icon">${{ earth: "◎", text: "T", logo: "C", ribbon: "╱", camera: "▣" }[o.type]}</span><span class="obj-name">${esc(o.name)}<small>${o.type.toUpperCase()} · ${o.in.toFixed(2)}–${o.out.toFixed(2)}</small></span><button class="eye" data-eye="${esc(o.id)}" title="参与输出" ${o.type === "camera" ? "disabled" : ""}>${icon(o.enabled ? "eye-line" : "eye-off-line")}</button></div>`,
    )
    .join("");
}
const number = (name, val, step = ".01", min, max, extra = "") =>
  `<input type="number" data-field="${name}" value="${round(val)}" step="${step}" ${min !== undefined ? `min="${min}"` : ""} ${max !== undefined ? `max="${max}"` : ""} ${extra}>`;
const field = (label, input) =>
  `<label class="field"><span>${label}</span>${input}</label>`;
function curveSVG(o) {
  if (isQuat(channel))
    return `<div class="quat-note">四元数姿态轨道 · SLERP 插值<br>通过 XYZ 角度输入框或画面圆环编辑方向；一个菱形代表完整姿态。</div>`;
  let ks = o.tracks[channel] || [],
    vs = Array.from({ length: 101 }, (_, i) =>
      sample(ks, (i / 100) * project.duration, o.base[channel]),
    ),
    lo = Math.min(...vs),
    hi = Math.max(...vs);
  if (hi - lo < 0.001) {
    hi += 0.5;
    lo -= 0.5;
  }
  let path = vs
    .map(
      (v, i) =>
        `${i ? "L" : "M"}${8 + i * 2.42},${66 - ((v - lo) / (hi - lo)) * 52}`,
    )
    .join(" ");
  return `<svg viewBox="0 0 258 78" style="display:block;width:100%;margin-top:10px;background:#13171b;border:1px solid #343b44;border-radius:4px" aria-label="${esc(CHANNELS[channel])} 插值预览"><path d="M8 66H250M8 14V66" fill="none" stroke="#313d49"/><path d="${path}" fill="none" stroke="#d6b275" stroke-width="1.5"/><line id="curveCursor" x1="${8 + (time / project.duration) * 242}" x2="${8 + (time / project.duration) * 242}" y1="10" y2="68" stroke="#8cabc9" stroke-dasharray="2 2"/></svg>`;
}
function rigEdit(fn) {
  play(false);
  commit(() => {
    let o = object(),
      before = clone(o);
    fn(o);
    if (keepPose) {
      let d = engine.compensate(before, o, time),
        v = values(before, time);
      for (let [i, ch] of ["x", "y", "z"].entries())
        if (Math.abs(d.getComponent(i)) > 1e-8)
          addKey(o.id, ch, time, v[ch] + d.getComponent(i));
    }
  });
}
const rotationNumberCache = new Map();
function rotationNumbers(o, ch, t) {
  const q = engine.rotation(o, ch, t),
    key = o.id + ":" + ch,
    cached = rotationNumberCache.get(key);
  if (cached && 1 - Math.abs(cached.q.dot(q)) < 1e-12)
    return cached.angles.slice();
  const e = new THREE.Euler().setFromQuaternion(q, "XYZ"),
    angles = [e.x, e.y, e.z].map(THREE.MathUtils.radToDeg);
  rotationNumberCache.set(key, { q: q.clone(), angles: angles.slice() });
  return angles;
}
function rotationFields(o) {
  const ch = transformMode === "parent" ? "groupRotation" : "rotation",
    a = rotationNumbers(o, ch, time);
  return `<div class="sub-label">${transformMode === "parent" ? "父级旋转" : "自身旋转"} / 度 · XYZ 欧拉角</div><div class="triple">${a.map((v, i) => `<div class="axis-field"><label>${"XYZ"[i]}</label>${number("rotationAngle." + i, v, ".1", undefined, undefined, `data-rotation-axis="${i}" data-rotation-channel="${ch}" aria-label="${transformMode === "parent" ? "父级" : "自身"}旋转 ${"XYZ"[i]} / 度"`)}</div>`).join("")}</div><p class="help">输入后按 Enter 或移出输入框，自动记录当前姿态。自身角度相对父级；父级角度相对世界。数值使用固定 XYZ 顺序，与手柄的局部 / 世界开关独立。</p>`;
}
function opacityPanel(o, v) {
  const percent = round(v.opacity * 100);
  return `<div class="form-section" id="opacityPanel"><h3>透明度动画 <span class="chip">元素独立</span></h3>${field("不透明度 / %", number("opacityPercent.value", percent, ".1", 0, 100, 'data-opacity-live="true" aria-label="元素不透明度百分比"'))}<input id="opacitySlider" type="range" min="0" max="100" step="0.1" value="${percent}" data-field="opacityPercent.value" data-opacity-live="true" style="width:100%;margin:8px 0" aria-label="元素不透明度滑块"><div class="rotation-actions"><button data-pin="opacity">◇ 记录透明度关键帧</button><button id="opacityTrack">查看透明度轨道</button></div><p class="help">0% 完全透明，100% 完全显示。修改即打帧；拖动时预览，松开记录一次。可在时间轴设置淡入淡出、缓动或删除关键帧。只作用于当前元素，也影响视频输出。</p><p class="help" id="opacityVisibility"></p></div>`;
}
function revealPanel(o, v) {
  const ks = o.tracks.reveal || [],
    start = ks[0]?.time ?? o.in,
    end = ks.at(-1)?.time ?? Math.min(o.out, o.in + 1),
    percent = round(v.reveal * 100);
  return `<div class="form-section" id="revealPanel"><h3>${o.id === "english" ? "英文副标题" : "文字"}显现动画 <span class="chip">关键帧控制</span></h3>${field("当前显现进度 / %", number("revealPercent.value", percent, ".1", 0, 100, 'data-reveal-live="true" aria-label="显现进度百分比"'))}<input id="revealSlider" type="range" min="0" max="100" step="0.1" value="${percent}" data-field="revealPercent.value" data-reveal-live="true" style="width:100%;margin:8px 0" aria-label="显现进度滑块"><div class="rotation-actions"><button data-pin="reveal">◇ 记录进度关键帧</button><button id="revealTrack">查看显现轨道</button></div><p class="help">0% 隐藏，100% 全部显示。修改即在当前时刻打帧；滑块拖动实时预览，松开记录一次。可添加中间帧控制快慢或停顿。选中关键帧后，在下方“运动通道”设置到下一帧的缓动。</p><p class="help" id="revealVisibility"></p><div class="sub-label">整体快慢 / 重排显现关键帧</div>${field("开始时间 / 秒", `<input id="revealStart" type="number" min="0" max="${project.duration}" step="0.041667" value="${round(start)}">`)}${field("完成时间 / 秒", `<input id="revealEnd" type="number" min="0" max="${project.duration}" step="0.041667" value="${round(end)}">`)}<div class="help" id="revealDuration">显现时段 ${round(end - start)} 秒 · ${ks.length} 个关键帧</div><button id="revealRetime" style="width:100%;margin-top:8px">应用时段 · 保留中间进度与缓动</button><p class="help">时段越短越快，越长越慢。只调整此文字的显现轨道；需要时自动扩大元素可见区间。无轨道或只有一帧时，生成 0% → 100% 两帧。</p></div>`;
}
function retimeReveal() {
  const start = Number($("#revealStart").value),
    end = Number($("#revealEnd").value);
  if (
    !$("#revealStart").value ||
    !$("#revealEnd").value ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end > project.duration ||
    end - start < 1 / project.fps
  )
    return toast("显现时段须位于全片范围内，且至少持续一帧", true);
  play(false);
  engine.previewMotion = null;
  const ok = commit(() => {
    const o = object(),
      ks = o.tracks.reveal || [],
      a = ks[0]?.time,
      b = ks.at(-1)?.time;
    let next =
      ks.length >= 2
        ? ks.map((k) => ({
            ...k,
            time: clamp(
              round(start + ((k.time - a) / (b - a)) * (end - start)),
              0,
              project.duration,
            ),
          }))
        : [
            { time: round(start), value: 0, easing: "linear" },
            {
              time: clamp(round(end), 0, project.duration),
              value: 1,
              easing: "linear",
            },
          ];
    if (next.some((k, i) => i && k.time - next[i - 1].time < 0.00001))
      throw Error("显现时段过短，关键帧将重叠，请延长时段");
    o.tracks.reveal = next;
    o.in = Math.min(o.in, start);
    o.out = Math.max(o.out, end);
    channel = "reveal";
    selectedKey = { id: o.id, channel: "reveal", time: next[0].time };
    transformMode = "self";
    expanded.add(o.id);
  });
  if (ok) {
    setTime(start);
    revealTime();
    toast("已调整此文字的显现时段，其他动画速度不变");
  }
}
const sectionState = new Map();
function appearancePanel(o) {
  const a = o.adjust || { hue: 0, saturation: 1, brightness: 1 };
  return `<div class="form-section"><h3>色彩调整</h3>${[
    ["hue", "色相 / °", -180, 180, 1],
    ["saturation", "饱和度", 0, 2, 0.01],
    ["brightness", "亮度", 0, 2, 0.01],
  ]
    .map(
      ([key, label, min, max, step]) =>
        field(label, number("adjust." + key, a[key], step, min, max)) +
        `<input class="appearance-slider" type="range" data-field="adjust.${key}" min="${min}" max="${max}" step="${step}" value="${a[key]}" aria-label="${label}">`,
    )
    .join("")}<button data-reset-appearance>重置色彩</button></div>`;
}
function layerHeader(o) {
  return `<div class="selection-title"><div class="icon-large">${icon(o.type === "background" ? "landscape-line" : o.type === "image" ? "image-line" : "text")}</div><strong>${esc(o.name)}</strong></div>${o.type === "background" ? "" : field("名称", `<input data-field="name" value="${esc(o.name)}">`)}${outputToggle(o.enabled)}<div class="form-section"><h3>时间范围</h3>${field("入点 / 秒", number("in", o.in, ".041667", 0, project.duration))}${field("出点 / 秒", number("out", o.out, ".041667", 0.001, project.duration))}</div>`;
}
function compactKeyPanel(o) {
  const k = activeKey();
  return `<div class="form-section"><h3>动画通道</h3>${field(
    "通道",
    `<select id="channelSelect">${channelEntries(o)
      .map(
        ([ch, label]) =>
          `<option value="${ch}" ${ch === channel ? "selected" : ""}>${label}</option>`,
      )
      .join("")}</select>`,
  )}${curveSVG(o)}${
    k
      ? field(
          "帧时间 / 秒",
          number("key.time", k.time, ".041667", 0, project.duration),
        ) +
        field("数值", number("key.value", k.value, ".01")) +
        field(
          "缓动",
          `<select data-field="key.easing">${Object.entries(EASINGS)
            .map(
              ([key, label]) =>
                `<option value="${key}" ${key === k.easing ? "selected" : ""}>${label}</option>`,
            )
            .join("")}</select>`,
        ) +
        `<button id="removeKey" class="danger">删除选中关键帧</button>`
      : ""
  }</div>`;
}
function renderBackgroundInspector() {
  const o = object();
  $("#inspectorState").textContent = "背景";
  $("#inspector").innerHTML =
    layerHeader(o) +
    `<div class="form-section"><h3>背景参数</h3>${Object.entries(BG_CHANNELS)
      .map(([ch, label]) =>
        field(
          label,
          number(
            "motion." + ch,
            sample(o.tracks[ch], time, o.base[ch]),
            ".01",
            undefined,
            undefined,
            `data-bg-live="${ch}"`,
          ),
        ),
      )
      .join("")}${Object.entries({
      dark: "深色底",
      blue: "光雾",
      light: "高光",
    })
      .map(([key, label]) =>
        field(
          label,
          `<input type="color" data-bg-color="${key}" value="${o.colors[key]}">`,
        ),
      )
      .join("")}</div>` +
    compactKeyPanel(o);
  organizeInspector();
}
function renderScreenInspector() {
  const o = object(),
    v = values(o, time);
  $("#inspectorState").textContent =
    o.type === "image" ? "图片叠加" : "2D 文字";
  const axes = (label, keys) =>
    `<div class="sub-label vector-heading"><span>${label}</span>${keys[0] === "sx" ? lockButton(o, "scale") : ""}</div><div class="triple screen-pair">${keys.map((ch) => `<div class="axis-field"><label>${ch.endsWith("x") ? "X" : "Y"}</label>${number("motion." + ch, v[ch], ch.startsWith("s") ? ".01" : "1", ch.startsWith("s") ? 0.001 : undefined, undefined, `data-live="${ch}"`)}</div>`).join("")}</div>`;
  let s =
    layerHeader(o) +
    `<div class="form-section"><h3>画面变换</h3><div class="coordinate-note">画面中心为原点 · X 向右 / Y 向上 · 1080p 像素坐标 · 拖动框内移动、角点缩放、上方圆点旋转</div>${axes("位置", ["x", "y"])}${axes("缩放", ["sx", "sy"])}${field("平面旋转 / °", number("motion.rz", v.rz, ".1", undefined, undefined, 'data-live="rz"'))}</div>` +
    opacityPanel(o, v);
  if (o.type === "text2d")
    s += `<div class="form-section"><h3>文字 / SVG</h3><div class="rotation-actions svg-mode"><button id="useTextSource" aria-pressed="${o.text.sourceMode !== "svg"}">使用文字</button><button id="uploadSvgSource">${o.text.svg ? "替换 SVG" : "上传 SVG"}</button>${o.text.svg ? `<button id="useSvgSource" aria-pressed="${o.text.sourceMode === "svg"}">使用 SVG</button>` : ""}</div><p class="svg-status">${o.text.sourceMode === "svg" ? `当前：SVG · ${esc(o.text.svg.name)}。字号控制图形高度。` : "支持上传已转路径的 SVG，按当前颜色显示为画面内平面图形。"}</p>${field("内容", `<textarea data-field="text.content" maxlength="100" ${o.text.sourceMode === "svg" ? "disabled" : ""}>${esc(o.text.content)}</textarea>`)}${field("字号 / px", number("text.size", o.text.size, "1", 4, 500))}${field("字距 / px", number("text.tracking", o.text.tracking, ".1", -5, 20))}${field("颜色", `<input type="color" data-field="material.color" value="${o.material.color}">`)}<button id="fontBtn">导入字体</button></div>`;
  else
    s += `<div class="form-section"><h3>图片素材</h3><button id="replaceImage">${icon("image-edit-line")} 替换图片</button>${field("宽度 / px", number("geometry.width", o.geometry.width, "1", 1, 8192))}${field("高度 / px", number("geometry.height", o.geometry.height, "1", 1, 8192))}<div class="coordinate-note">保留原图透明通道。等比调整请使用缩放锁。</div></div>`;
  s +=
    appearancePanel(o) +
    compactKeyPanel(o) +
    `<div class="form-section"><button id="deleteObject" class="danger">删除此元素</button></div>`;
  $("#inspector").innerHTML = s;
  organizeInspector();
}
function organizeInspector() {
  const root = $("#inspector"),
    o = object();
  root
    .querySelectorAll(
      "p.help:not([id]), .rig-tree, .inline-note, .quat-note, .rotation-readout",
    )
    .forEach((n) => n.remove());
  root.querySelectorAll("h3 span").forEach((n) => n.remove());
  const sections = [...root.querySelectorAll(":scope > .form-section")];
  const motion = sections.find((n) =>
      n.querySelector("h3")?.textContent.startsWith("运动控制"),
    ),
    rotation = root.querySelector(".rotation-panel");
  if (motion) {
    motion.querySelector("h3").textContent = "变换";
    if (rotation) {
      rotation.querySelector("h3")?.remove();
      rotation.querySelector(".rotation-target")?.remove();
      while (rotation.firstChild) motion.append(rotation.firstChild);
      rotation.remove();
    }
    const first = root.querySelector(":scope > .form-section");
    root.insertBefore(motion, first);
  }
  if (
    !isScreen(o) &&
    !["camera", "background", "audio", "project"].includes(o.type)
  ) {
    root.insertAdjacentHTML("beforeend", appearancePanel(o));
    const mat = [...root.querySelectorAll(".form-section")].find((n) =>
      n.querySelector("h3")?.textContent.includes("金属材质"),
    );
    if (mat) {
      mat.querySelector("h3").textContent = "材质";
      mat.insertAdjacentHTML(
        "beforeend",
        field(
          "清漆",
          number("material.clearcoat", o.material.clearcoat ?? 0, ".01", 0, 1),
        ) +
          field(
            "清漆粗糙度",
            number(
              "material.clearcoatRoughness",
              o.material.clearcoatRoughness ?? 0.1,
              ".01",
              0,
              1,
            ),
          ) +
          field(
            "自发光颜色",
            `<input type="color" data-field="material.emissive" value="${o.material.emissive ?? "#000000"}">`,
          ) +
          field(
            "自发光强度",
            number(
              "material.emissiveIntensity",
              o.material.emissiveIntensity ?? 0,
              ".05",
              0,
              5,
            ),
          ),
      );
    }
    const geo = root
      .querySelector('[data-field="text.depth"]')
      ?.closest(".form-section");
    if (geo) {
      geo.insertAdjacentHTML(
        "afterbegin",
        '<div class="bevel-presets"><button data-bevel="flat">直角</button><button data-bevel="chamfer">斜边</button><button data-bevel="round">圆润凸角</button></div>',
      );
      for (const [key, label] of [
        ["depth", "凸起厚度"],
        ["bevelSize", "斜边宽度"],
        ["bevelThickness", "斜边深度"],
        ["bevelSegments", "斜边分段"],
      ])
        root
          .querySelector(`[data-field="text.${key}"]`)
          ?.closest("label")
          ?.querySelector("span")
          ?.replaceChildren(document.createTextNode(label));
    }
  }
  const textPanel = [...root.querySelectorAll(":scope > .form-section")].find(
    (n) => n.querySelector("h3")?.textContent === "3D 文字 / SVG",
  );
  if (textPanel)
    root.insertBefore(textPanel, root.querySelector(":scope > .form-section"));
  for (const section of [...root.querySelectorAll(":scope > .form-section")]) {
    const h = section.querySelector("h3");
    if (!h) continue;
    const title = h.textContent.trim(),
      details = document.createElement("details"),
      summary = document.createElement("summary");
    details.className = "property-group";
    details.dataset.group = title;
    summary.textContent = title;
    h.remove();
    details.append(summary);
    section.replaceWith(details);
    details.append(section);
    details.open =
      sectionState.get(title) ??
      ![
        "运动通道",
        "动画通道",
        "文字显现动画",
        "英文副标题显现动画",
        "文字几何",
        "几何参数",
      ].includes(title);
    details.addEventListener("toggle", () =>
      sectionState.set(title, details.open),
    );
  }
}
function createScreenElement(type, asset) {
  commit(() => {
    const template = clone(initial.objects.find((o) => o.type === "text"));
    const o = {
      ...template,
      id:
        type +
        "-" +
        (globalThis.crypto?.randomUUID?.() ??
          Date.now().toString(36) + Math.random().toString(36).slice(2)),
      type,
      name: type === "image" ? asset.name : "2D 叠加文字",
      userCreated: true,
      in: 0,
      out: project.duration,
      enabled: true,
      tracks: {},
      pivot: { preset: "center", offset: [0, 0, 0] },
      orbit: { center: [0, 0, 0] },
      links: { scale: true },
      base: Object.fromEntries(
        Object.keys(SCALAR_CHANNELS).map((ch) => [
          ch,
          /^g?s[xyz]$/.test(ch) || ["opacity", "reveal"].includes(ch) ? 1 : 0,
        ]),
      ),
    };
    delete o.rotationReference;
    o.material = {
      color: "#ffffff",
      sideColor: "#ffffff",
      metalness: 0,
      roughness: 1,
    };
    if (type === "image") {
      delete o.text;
      delete o.material;
      const w = Math.min(320, asset.width);
      o.asset = { src: asset.src };
      o.geometry = { width: w, height: (w * asset.height) / asset.width };
    } else {
      o.text = {
        ...o.text,
        content: "叠加文字",
        size: 64,
        tracking: 0,
        depth: 0,
        bevelSize: 0,
        bevelThickness: 0,
      };
    }
    project.objects.push(o);
    selected = o.id;
    channel = "x";
    selectedKey = null;
  }, true);
}
function dragClip(e, clip) {
  e.preventDefault();
  e.stopPropagation();
  play(false);
  const id = clip.dataset.clip,
    part = e.target.dataset.trim,
    o = findObject(id),
    start = e.clientX,
    a = o.in,
    b = o.out,
    before = JSON.stringify(project);
  const audioOffset = id === "__audio__" ? audioSettings(project).offset : 0;
  selected = id;
  selectedKey = null;
  if (!channelEntries(o).some(([c]) => c === channel))
    channel = channelEntries(o)[0]?.[0] || "";
  dragging = true;
  refresh();
  let moved = false;
  const move = (ev) => {
    if (Math.abs(ev.clientX - start) < 3 && !moved) return;
    moved = true;
    let d = (ev.clientX - start) / pps;
    if ($("#snap").checked) d = Math.round(d * project.fps) / project.fps;
    const min = Math.min(1 / project.fps, b - a);
    if (part === "in") {
      o.in = round(
        clamp(
          a + d,
          id === "__audio__" ? Math.max(0, a - audioOffset) : 0,
          id === "__audio__"
            ? Math.min(b - min, a + 600 - audioOffset)
            : b - min,
        ),
      );
      if (id === "__audio__") ensureAudio().offset = audioOffset + o.in - a;
    } else if (part === "out")
      o.out = round(clamp(b + d, a + min, project.duration));
    else {
      d = clamp(d, -a, project.duration - b);
      o.in = round(a + d);
      o.out = round(b + d);
    }
    workbench.invalidatePath();
    renderTimeline();
    renderInspector();
    frame();
  };
  const finish = (cancel) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancelFn);
    window.removeEventListener("keydown", escape);
    if (cancel) {
      o.in = a;
      o.out = b;
      if (id === "__audio__") ensureAudio().offset = audioOffset;
      if (id === "__background__" && !JSON.parse(before).scene.backdrop)
        delete project.scene.backdrop;
      if (id === "__audio__" && !JSON.parse(before).audio) delete project.audio;
    } else if (moved) {
      try {
        validate(project);
        if (before !== JSON.stringify(project)) history(before);
      } catch (err) {
        o.in = a;
        o.out = b;
        if (id === "__audio__") ensureAudio().offset = audioOffset;
        toast(err.message, true);
      }
    }
    refresh();
    setTimeout(() => (dragging = false), 0);
  };
  const up = () => finish(false),
    cancelFn = () => finish(true),
    escape = (ev) => {
      if (ev.key === "Escape") finish(true);
    };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
  window.addEventListener("pointercancel", cancelFn, { once: true });
  window.addEventListener("keydown", escape);
}

function renderInspector() {
  if (object().type === "project") return renderProjectInspector();
  if (object().type === "audio") return renderAudioInspector();
  if (object().type === "background") return renderBackgroundInspector();
  if (isScreen(object())) return renderScreenInspector();
  let o = object(),
    v = values(o, time),
    k = activeKey();
  $("#inspectorState").textContent =
    {
      text: "3D 文字",
      logo: "图形标识",
      ribbon: "彩条",
      earth: "地球",
      camera: "相机",
    }[o.type] || o.type;
  let axis = (label, keys) =>
    `<div class="sub-label vector-heading"><span>${label}</span>${lockButton(o, groupFor(keys[0]))}</div><div class="triple">${keys.map((ch, i) => `<div class="axis-field"><label><span>${"XYZ"[i]}</span><button data-pin="${ch}" class="${o.tracks[ch]?.length ? "keyed" : ""}" title="在当前时间打关键帧">${icon("poker-diamonds-line")}</button></label>${number("motion." + ch, v[ch], /^g?r/.test(ch) ? "1" : ".01", /^g?s[xyz]$/.test(ch) ? 0.001 : undefined, undefined, `data-live="${ch}" aria-label="${CHANNELS[ch]}"`)}</div>`).join("")}</div>`;
  let s = `<div class="selection-title"><div class="icon-large">${icon(o.type === "text" ? "text-block" : o.type === "earth" ? "earth-line" : o.type === "camera" ? "camera-line" : "box-3-line")}</div><div><strong>${esc(o.name)}</strong><small>${esc(o.id)}</small></div></div>${field("名称", `<input data-field="name" value="${esc(o.name)}" maxlength="60">`)}${o.type === "camera" ? "" : outputToggle(o.enabled)}<div class="form-section"><h3>时间范围</h3>${field("入点 / 秒", number("in", o.in, ".041667", 0, project.duration))}${field("出点 / 秒", number("out", o.out, ".041667", 0.001, project.duration))}</div>`;
  if (o.type !== "camera") s += opacityPanel(o, v);
  if (o.type === "text") s += revealPanel(o, v);
  if (o.type !== "camera")
    s += `<div class="form-section rotation-panel"><h3>旋转 · 数值与手柄 <span class="chip">XYZ / QUAT</span></h3><div class="rotation-target"><button data-rig-mode="self" class="${transformMode === "self" ? "active" : ""}">对象自转</button><button data-rig-mode="parent" class="${transformMode === "parent" ? "active" : ""}">父级公转</button></div>${rotationFields(o)}${field(
      "角度吸附",
      `<select id="rotationSnap">${[
        [0, "自由旋转"],
        [1, "1°"],
        [5, "5°"],
        [15, "15°"],
        [30, "30°"],
        [45, "45°"],
      ]
        .map(
          ([value, label]) =>
            `<option value="${value}" ${gizmoSnap === value ? "selected" : ""}>${label}</option>`,
        )
        .join("")}</select>`,
    )}<div class="axis-legend"><span class="axis-x">● X</span><span class="axis-y">● Y</span><span class="axis-z">● ${gizmoSpace === "world" ? "Z / 世界轴" : transformMode === "parent" ? "Z / 父级轴" : ["text", "logo"].includes(o.type) ? "Z / 正面法向" : "Z / 局部轴"}</span></div><p class="help">直接拖动画面圆环。局部轴跟随物体朝向；松开记录姿态关键帧，Esc 取消本次拖动。</p><div class="rotation-actions"><button id="keyRotation">◇ 记录当前姿态</button></div><div id="rotationReadout" class="rotation-readout">拖动圆环开始旋转</div></div>`;
  s += `<div class="form-section"><h3>运动控制 <span style="float:right;color:#a58c60">修改即打帧 ◇</span></h3>`;
  if (o.type !== "camera")
    s += `<div class="rig-tabs"><button data-rig-mode="self" class="${transformMode === "self" ? "active" : ""}">● 自身变换</button><button data-rig-mode="parent" class="${transformMode === "parent" ? "active" : ""}">◇ 父级公转</button></div>`;
  if (transformMode === "parent" && o.type !== "camera") {
    s += `<div class="inline-note">这一层绕“父级中心”转动整个元素。自转和公转可同时存在。</div><div class="sub-label vector-heading"><span>父级中心 / 世界坐标（静态）</span>${lockButton(o, "orbit")}</div><div class="triple">${o.orbit.center.map((v, i) => `<div class="axis-field"><label>${"XYZ"[i]}</label>${number("orbit." + i, v, ".1")}</div>`).join("")}</div><div class="rig-shortcuts"><button id="centerEarth">取地球中心</button><button id="centerPivot">取当前支点</button><button id="centerWorld">世界原点</button></div>${axis("父级位移 / 世界坐标", ["gx", "gy", "gz"])}<p class="help">父级方向可用上方 XYZ 角度框或圆环编辑。</p>${axis("父级缩放", ["gsx", "gsy", "gsz"])}<div class="rig-shortcuts"><button id="orbit360">添加 Y 轴一圈公转</button><button id="resetParent">重置父级</button></div><p class="help">“取地球中心”采样当前帧，不会自动跟随之后移动的地球。</p>`;
  } else {
    s += `${axis(o.type === "camera" ? "位置 / 世界坐标" : "位置 / 父级未旋转坐标", ["x", "y", "z"])}${o.type === "camera" ? axis("相机旋转 / 度", ["rx", "ry", "rz"]) : ""}${o.type !== "camera" ? axis("自身缩放", ["sx", "sy", "sz"]) : ""}`;
  }
  s += `<div class="help">旋转可输入 XYZ 角度，也可拖动手柄；两者共用四元数姿态轨道。</div></div>`;
  s += `<div class="form-section"><h3>运动通道</h3>${field(
    "通道",
    `<select id="channelSelect">${channelEntries(o)
      .map(
        ([c, label]) =>
          `<option value="${c}" ${c === channel ? "selected" : ""}>${label} · ${o.tracks[c]?.length || 0} 帧</option>`,
      )
      .join("")}</select>`,
  )}${curveSVG(o)}`;
  if (k)
    s += `<div class="key-panel"><div style="font-size:10px;color:#e2c48c;margin-bottom:8px">◆ ${selectedKey.aggregate ? `已选同一时刻 ${selectionEntries().length} 个通道` : `已选 ${CHANNELS[selectedKey.channel]}`}<br><span class="help">编辑 ${CHANNELS[selectedKey.channel]}${isQuat(selectedKey.channel) ? " · 整体姿态" : "（数值遵循比例锁）"}${selectedKey.aggregate ? "；删除作用于全部选中通道" : ""}</span></div>${field("时间 / 秒", number("key.time", k.time, ".041667", 0, project.duration))}${isQuat(selectedKey.channel) ? `<div class="quat-value">姿态 [${k.value.map((v) => v.toFixed(4)).join(", ")}]<br><span class="help">使用上方 XYZ 角度框或圆环编辑，不直接修改四元数分量。</span></div>` : field(selectedKey.channel === "opacity" ? "不透明度 / %" : selectedKey.channel === "reveal" ? "显现进度 / %" : "数值", number(selectedKey.channel === "opacity" ? "keyOpacity.value" : selectedKey.channel === "reveal" ? "keyReveal.value" : "key.value", ["opacity", "reveal"].includes(selectedKey.channel) ? k.value * 100 : k.value, ".01"))}${field(
      "到下一帧的缓动",
      `<select data-field="key.easing">${Object.entries(EASINGS)
        .map(
          ([id, label]) =>
            `<option value="${id}" ${id === k.easing ? "selected" : ""}>${label}</option>`,
        )
        .join("")}</select>`,
    )}<div class="key-actions"><button id="previousKey">← 前一帧点</button><button id="nextKey">后一帧点 →</button><button id="removeKey">${selectedKey.aggregate ? "删除此时刻全部帧" : "删除此通道帧"}</button></div></div>`;
  else
    s += `<p class="help" style="margin-top:8px">选择时间轴菱形可编辑时间、数值与缓动。缓动作用于所选帧之后的区间。</p>`;
  s += "</div>";
  if (o.type === "text") {
    let p = o.text;
    s += `<div class="form-section"><h3>3D 文字 / SVG</h3><div class="rotation-actions svg-mode"><button id="useTextSource" aria-pressed="${p.sourceMode !== "svg"}">使用文字</button><button id="uploadSvgSource">${p.svg ? "替换 SVG" : "上传 SVG"}</button>${p.svg ? `<button id="useSvgSource" aria-pressed="${p.sourceMode === "svg"}">使用 SVG</button>` : ""}</div><p class="svg-status">当前：${p.sourceMode === "svg" ? `SVG · ${esc(p.svg.name)}` : "可编辑文字"}。SVG 使用填充轮廓挤出，统一采用下方材质；文字需先转路径。SVG 高度由字号控制，不使用字距和字体。</p><label class="field full"><span>文字内容 / 单行</span><textarea data-field="text.content" maxlength="100" ${p.sourceMode === "svg" ? "disabled" : ""}>${esc(p.content)}</textarea></label>${field(p.sourceMode === "svg" ? "SVG 高度 / 世界单位" : "字号 / 世界单位", number("text.size", p.size, ".05", 0.05, 20))}${field("字距 / 额外间距", number("text.tracking", p.tracking, ".01", -5, 20))}${field("挤出厚度", number("text.depth", p.depth, ".01", 0, 10))}${field("倒角宽度", number("text.bevelSize", p.bevelSize, ".005", 0, 1))}${field("倒角厚度", number("text.bevelThickness", p.bevelThickness, ".005", 0, 1))}${field("倒角分段", number("text.bevelSegments", p.bevelSegments, "1", 1, 8))}${field("曲线精度", number("text.curveSegments", p.curveSegments, "1", 2, 16))}<div class="font-row"><span>${project.fontData ? "自定义字体" : "思源黑体 / 常用简体中文"}</span><button id="fontBtn">导入字体</button></div><p class="help" style="margin-top:5px">支持 OTF / TTF。字体对所有文字生效；缺字会提示，不会静默替换。</p></div>`;
  }
  if (o.type === "logo")
    s += `<div class="form-section"><h3>CCTV 标识文字</h3><button id="logoToText">转换为可编辑文字</button><p class="help">保留原运动轨道，将图形标识改为字体字形后可修改内容及字号。可撤销。</p></div>`;
  if (o.type === "ribbon")
    s += `<div class="form-section"><h3>彩条图片 · 透明 PNG</h3>${field(
      "素材",
      `<select data-field="image">${[
        ["red", "红色彩条"],
        ["blue", "蓝色彩条"],
        ["green", "绿色彩条"],
      ]
        .map(
          ([value, label]) =>
            `<option value="${value}" ${o.image === value ? "selected" : ""}>${label}</option>`,
        )
        .join("")}</select>`,
    )}<p class="help">使用 static 目录中的原始 PNG，不再生成立体条带。图片已有透视造型；可用上方角度框和 3D 手柄继续调整。宽高控制图片尺寸，原色不受灯光影响。</p></div>`;
  if (o.geometry) {
    s += `<div class="form-section"><h3>几何参数</h3>${Object.entries(
      o.geometry,
    )
      .filter(([key]) => o.type !== "ribbon" || key !== "depth")
      .map(([key, val]) =>
        field(
          {
            width: "宽度",
            height: "高度",
            depth: "厚度",
            bevelSize: "倒角宽度",
          }[key],
          number("geometry." + key, val, ".01", 0, 100),
        ),
      )
      .join("")}</div>`;
  }
  if (o.type === "earth") {
    const p = earthMaterial(o);
    s += `<div class="form-section"><h3>地球材质</h3>${field("材质模型", `<select data-field="earthMaterial.model"><option value="classic" ${p.model === "classic" ? "selected" : ""}>参考外观 · 高光材质</option><option value="physical" ${p.model === "physical" ? "selected" : ""}>物理材质 · 金属 / 粗糙度</option></select>`)}${p.model === "physical" ? field("金属度", number("earthMaterial.metalness", p.metalness, ".01", 0, 1)) + field("粗糙度", number("earthMaterial.roughness", p.roughness, ".01", 0, 1)) + field("清漆", number("earthMaterial.clearcoat", p.clearcoat, ".01", 0, 1)) + field("清漆粗糙度", number("earthMaterial.clearcoatRoughness", p.clearcoatRoughness, ".01", 0, 1)) : ""}${field("表面颜色", `<input type="color" data-field="earthMaterial.color" value="${p.color}">`)}${p.model === "classic" ? field("高光颜色", `<input type="color" data-field="earthMaterial.specular" value="${p.specular}">`) + field("高光锐度", number("earthMaterial.shininess", p.shininess, "1", 0, 200)) : ""}${field("自发光颜色", `<input type="color" data-field="earthMaterial.emissive" value="${p.emissive}">`)}${field("自发光强度", number("earthMaterial.emissiveIntensity", p.emissiveIntensity, ".05", 0, 5))}${field("云层不透明度", number("earthMaterial.cloudOpacity", p.cloudOpacity, ".01", 0, 1))}<div class="sub-label">边缘外发光</div><label class="output-toggle"><span>外发光</span><input type="checkbox" role="switch" aria-label="地球外发光" data-field="earthMaterial.glowEnabled" ${p.glowEnabled ? "checked" : ""}></label>${field("光晕颜色", `<input type="color" data-field="earthMaterial.glowColor" value="${p.glowColor}">`)}${field("光晕强度", number("earthMaterial.glowIntensity", p.glowIntensity, ".05", 0, 5))}${field("光晕宽度 / 半径比例", number("earthMaterial.glowWidth", p.glowWidth, ".005", 0.001, 0.2))}${field("光晕衰减", number("earthMaterial.glowFalloff", p.glowFalloff, ".1", 0.5, 8))}${field("边缘提亮", number("earthMaterial.rimIntensity", p.rimIntensity, ".05", 0, 5))}<button id="resetEarthMaterial">恢复默认材质</button></div>`;
  }
  if (o.material && o.type !== "ribbon") {
    s += `<div class="form-section"><h3>金属材质 <span style="float:right;color:#748191">全片静态</span></h3>${field("正面颜色", `<input type="color" data-field="material.color" value="${o.material.color}">`)}${field("侧面颜色", `<input type="color" data-field="material.sideColor" value="${o.material.sideColor}">`)}${field("金属度", number("material.metalness", o.material.metalness, ".01", 0, 1))}${field("粗糙度", number("material.roughness", o.material.roughness, ".01", 0, 1))}</div>`;
  }
  if (o.type === "camera")
    s += `<div class="form-section"><h3>透视相机</h3>${field("垂直视野 / 度", number("projection.fov", o.projection.fov, "1", 5, 120))}${field("近裁切", number("projection.near", o.projection.near, ".01", 0.001, 10))}${field("远裁切", number("projection.far", o.projection.far, "1", 0.1, 10000))}<p class="help">相机默认朝向 -Z。相机位置与旋转同样支持关键帧。</p></div>`;
  s += `<div class="form-section"><button id="deleteObject" class="danger" ${protectedObject(o) ? "disabled" : ""}>${protectedObject(o) ? "预设元素 · 不可删除" : "删除此元素"}</button><p class="help" style="margin-top:8px">删除与属性修改均支持撤销。</p></div>`;
  $("#inspector").innerHTML = s;
  organizeInspector();
}
function layoutTimeline() {
  labelWidth = 200;
  pps =
    Math.max(
      8,
      ($("#timelineScroll").clientWidth - labelWidth - 24) / project.duration,
    ) * Number($("#zoom").value);
}
let lastTimelineSelection = null;
function renderTimeline() {
  layoutTimeline();
  let width = Math.max(1, project.duration * pps),
    step = pps > 55 ? 1 : pps > 25 ? 2 : pps > 10 ? 5 : 10;
  let ruler = "";
  for (let t = 0; t <= project.duration; t += step)
    ruler += `<span class="tl-tick" style="left:${t * pps}px">${String(t).padStart(2, "0")}s</span>`;
  const dots = (o, ch = null) => {
    let entries = ch
      ? (o.tracks[ch] || []).map((k) => ({ time: k.time, channel: ch }))
      : [
          ...new Set(
            Object.values(o.tracks)
              .flat()
              .map((k) => k.time),
          ),
        ]
          .sort((a, b) => a - b)
          .map((t) => ({
            time: t,
            channel: Object.keys(o.tracks).find((c) =>
              o.tracks[c].some((k) => k.time === t),
            ),
          }));
    return entries
      .map(
        (k) =>
          `<button class="diamond ${selectedKey?.id === o.id && Math.abs(selectedKey.time - k.time) < 1e-7 && (!ch || selectedKey.aggregate || selectedKey.channel === ch) ? "selected" : ""}" style="left:${k.time * pps}px" data-key-id="${esc(o.id)}" data-key-channel="${esc(k.channel)}" data-key-time="${k.time}" data-aggregate="${!ch}" title="${ch ? esc(CHANNELS[k.channel]) : "同一时刻全部通道"} · ${k.time.toFixed(3)}s" aria-label="${esc(o.name)} ${esc(CHANNELS[k.channel])} ${k.time.toFixed(3)} 秒关键帧"></button>`,
      )
      .join("");
  };
  let html = `<div class="tl-ruler"><div class="tl-label"><span>图层 / 通道</span><button id="solo" aria-label="独显选中元素" aria-pressed="${solo}" title="主预览仅显示选中元素，不影响视频导出" ${!solo && ["camera", "project", "audio"].includes(object().type) ? "disabled" : ""}>${icon("focus-3-line")} 独显</button></div><div class="tl-track ruler-track" style="width:${width}px" data-ruler="true">${ruler}</div></div>`;
  for (let o of layers()) {
    html += `<div class="tl-row type-${o.type} ${o.enabled ? "" : "muted-layer"} ${selected === o.id ? "selected" : ""}"><div class="tl-label" data-select="${esc(o.id)}"><button class="expand" data-expand="${esc(o.id)}" ${o.type === "audio" ? "disabled" : ""}>${o.type === "audio" ? icon("music-2-line") : icon(expanded.has(o.id) ? "arrow-down-s-line" : "arrow-right-s-line")}</button><span class="name">${esc(o.name)}</span><button class="layer-eye" data-layer-eye="${esc(o.id)}" ${o.type === "camera" ? "disabled" : ""} title="${o.enabled ? "关闭参与输出" : "开启参与输出"}" aria-label="${esc(o.name)}：参与输出" aria-pressed="${o.enabled}">${icon(o.enabled ? "eye-line" : "eye-off-line")}</button></div><div class="tl-track" data-track="${esc(o.id)}" style="width:${width}px"><div class="clip-bar" data-clip="${esc(o.id)}" title="拖动时间范围；关键帧时间不变" style="left:${o.in * pps}px;width:${Math.max(1, (o.out - o.in) * pps)}px">${o.type === "audio" ? audioWaveMarkup(o) : ""}<span data-trim="in" title="调整入点"></span><span data-trim="out" title="调整出点"></span></div>${dots(o)}</div></div>`;
    if (expanded.has(o.id)) {
      let cs = Object.keys(CHANNELS).filter(
        (c) => o.tracks[c]?.length || (o.id === selected && c === channel),
      );
      for (let c of cs)
        html += `<div class="tl-row channel-row ${o.id === selected && c === channel ? "selected" : ""}"><div class="tl-label" data-select="${esc(o.id)}" data-channel="${c}"><span class="channel-name">${o.type === "background" ? BG_CHANNELS[c] : CHANNELS[c]}</span></div><div class="tl-track" data-track="${esc(o.id)}" data-channel="${c}" style="width:${width}px">${dots(o, c)}</div></div>`;
    }
  }
  html += '<div class="playhead" id="playhead"></div>';
  let el = $("#timelineContent");
  el.style.width = labelWidth + width + 12 + "px";
  el.style.setProperty("--pps", pps + "px");
  el.innerHTML = html;
  if (selected !== lastTimelineSelection) {
    lastTimelineSelection = selected;
    if (selected)
      el.querySelector(
        `[data-select="${CSS.escape(selected)}"]`,
      )?.scrollIntoView({ block: "nearest" });
  }
  updatePlayhead();
}
function updatePlayhead() {
  const p = $("#playhead");
  if (p) {
    p.style.left = labelWidth + time * pps + "px";
    p.style.visibility =
      time * pps < $("#timelineScroll").scrollLeft ? "hidden" : "visible";
  }
}
function refresh() {
  workbench.invalidatePath();
  if (selected && !findObject(selected)) selected = null;
  if (!channelEntries(object()).some(([c]) => c === channel))
    channel = channelEntries(object())[0]?.[0] || "";
  $("#projectName").textContent = project.name;
  $("#totalTime").textContent = project.duration.toFixed(2);
  $("#fpsLabel").textContent = project.fps + " FPS";
  $("#aspectLabel").textContent = project.aspect.join(":");
  $("#timeInput").max = project.duration;
  $("#timeInput").step = 1 / project.fps;
  $("#undo").disabled = !undoStack.length;
  $("#redo").disabled = !redoStack.length;
  $("#deleteKey").disabled = !selectionEntries().length;
  $("#deleteKey").textContent = selectedKey?.aggregate
    ? "删除选中帧 (" + selectionEntries().length + ")"
    : "删除帧";
  $("#deleteKey").title = selectedKey?.aggregate
    ? "删除当前元素在选中时刻的所有通道关键帧"
    : "删除选中的单通道关键帧";
  $("#duplicate").disabled = [
    "camera",
    "background",
    "audio",
    "project",
  ].includes(object().type);
  $("#play").innerHTML =
    icon(playing ? "pause-fill" : "play-fill") + (playing ? " 暂停" : " 播放");
  $("#selectionInfo").textContent =
    object().name + (channel ? " / " + CHANNELS[channel] : "");
  $("#addKey").disabled = !channelEntries(object()).length;
  renderObjects();
  renderInspector();
  renderTimeline();
  fitStage();
  updateWorkbenchUI();
  frame();
  syncMusic();
  updateAudioWave();
  decorateIcons();
}
function frame() {
  updateKeyNavigation();
  $("#gizmoEnabledInput").checked = gizmoEnabled;
  engine.render(
    project,
    time,
    solo && !["camera", "project", "audio"].includes(object().type)
      ? selected
      : null,
    {
      id: selected,
      pivot: $("#showPivot").checked,
      path: $("#showPath").checked,
      gizmo: {
        id: selected,
        target: transformMode,
        enabled:
          gizmoEnabled &&
          !playing &&
          (!gizmoSession || gizmoSession.view.kind === "main"),
        mode: workbench.mode,
        space: gizmoSpace,
        snap: workbench.ctrl ? 5 : gizmoSnap,
      },
    },
  );
  workbench.controls.setRotationSnap(
    (((workbench.ctrl ? 5 : gizmoSnap) || 0) * Math.PI) / 180 || null,
  );
  workbench.render(
    project,
    time,
    selected,
    transformMode,
    gizmoEnabled &&
      !playing &&
      (!gizmoSession || gizmoSession.view === workbench),
  );
  updateScreenOutline();
  updatePlayhead();
  if (document.activeElement !== $("#timeInput"))
    $("#timeInput").value = time.toFixed(3);
  $("#frameInfo").textContent =
    `FRAME ${String(Math.min(Math.ceil(project.duration * project.fps) - 1, Math.floor(time * project.fps))).padStart(3, "0")} / ${Math.ceil(project.duration * project.fps) - 1}`;
  let v = engine.motionValues(object(), time);
  $$("[data-bg-live]").forEach((e) => {
    if (document.activeElement !== e)
      e.value = round(
        sample(
          object().tracks[e.dataset.bgLive],
          time,
          object().base[e.dataset.bgLive],
        ),
      );
  });
  $$("[data-live]").forEach((e) => {
    if (document.activeElement !== e) e.value = round(v[e.dataset.live]);
  });
  $$("[data-opacity-live]").forEach((e) => {
    if (document.activeElement !== e) e.value = round(v.opacity * 100);
  });
  if ($("#opacityVisibility"))
    $("#opacityVisibility").textContent =
      time < object().in || time > object().out
        ? "当前时间在此元素可见区间外，请定位到入点之后查看效果。"
        : "";
  if ($("#revealVisibility"))
    $("#revealVisibility").textContent =
      time < object().in || time > object().out
        ? "当前时间在此文字可见区间外；请定位到入点之后查看效果。"
        : "";
  $$("[data-reveal-live]").forEach((e) => {
    if (document.activeElement !== e) e.value = round(v.reveal * 100);
  });
  $$("[data-rotation-axis]").forEach((e) => {
    if (document.activeElement !== e)
      e.value = round(
        rotationNumbers(object(), e.dataset.rotationChannel, time)[
          Number(e.dataset.rotationAxis)
        ],
      );
  });
  if (!gizmoSession && $("#rotationReadout"))
    $("#rotationReadout").textContent =
      object().enabled && time >= object().in && time <= object().out
        ? gizmoEnabled
          ? (gizmoSpace === "local"
              ? "局部轴 · 跟随对象"
              : "世界轴 · 方向固定") + " · 拖动彩色圆环"
          : "圆环已隐藏 · 点击显示圆环"
        : "当前时刻元素不可见，请先定位到可见区间";
  let cursor = $("#curveCursor");
  if (cursor) {
    cursor.setAttribute("x1", 8 + (time / project.duration) * 242);
    cursor.setAttribute("x2", 8 + (time / project.duration) * 242);
  }
}
function fitStage() {
  let box = $("#previewSpace"),
    style = getComputedStyle(box),
    w =
      box.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight),
    h =
      box.clientHeight -
      parseFloat(style.paddingTop) -
      parseFloat(style.paddingBottom),
    aspect = project.aspect[0] / project.aspect[1],
    compare = $("#compare").checked;
  $("#stageGrid").style.width =
    Math.max(
      1,
      Math.min(
        w,
        compare && editViewOpen
          ? ((h - 10) * aspect) / 2
          : h * aspect * (compare ? 2 : 1) + (compare ? 10 : 0),
      ),
    ) + "px";
  $("#renderStage").style.aspectRatio = aspect;
  previewViewport.resize();
}
$("#objectList").onclick = (e) => {
  let eye = e.target.closest("[data-eye]");
  if (eye)
    return commit(() => {
      let o = project.objects.find((o) => o.id === eye.dataset.eye);
      o.enabled = !o.enabled;
    });
  let row = e.target.closest("[data-object]");
  if (row) select(row.dataset.object, { seek: true });
};
$("#inspector").addEventListener("keydown", (e) => {
  if (
    (e.target.dataset.rotationAxis !== undefined ||
      e.target.dataset.field === "revealPercent.value" ||
      e.target.dataset.field === "keyReveal.value" ||
      e.target.dataset.field === "opacityPercent.value" ||
      e.target.dataset.field === "keyOpacity.value") &&
    e.key === "Enter"
  ) {
    e.preventDefault();
    e.target.blur();
  }
});
$("#inspector").addEventListener("input", (e) => {
  if (["revealSlider", "opacitySlider"].includes(e.target.id)) {
    play(false);
    engine.previewMotion = {
      id: selected,
      values: {
        [e.target.id === "opacitySlider" ? "opacity" : "reveal"]:
          Number(e.target.value) / 100,
      },
    };
    frame();
  }
  if (["revealStart", "revealEnd"].includes(e.target.id)) {
    const d = Number($("#revealEnd").value) - Number($("#revealStart").value);
    $("#revealDuration").textContent =
      Number.isFinite(d) && d > 0
        ? "新时段 " + round(d) + " 秒 · 点击应用生效"
        : "完成时间须晚于开始时间";
  }
});
$("#inspector").addEventListener("pointercancel", (e) => {
  if (["revealSlider", "opacitySlider"].includes(e.target.id)) {
    engine.previewMotion = null;
    frame();
  }
});
$("#inspector").onchange = (e) => {
  let el = e.target;
  if (el.id === "rotationSnap") {
    gizmoSnap = Number(el.value);
    frame();
    return;
  }
  if (el.id === "keepPose") {
    keepPose = el.checked;
    return;
  }
  if (el.id === "channelSelect") {
    keyNavigationScope = "channel";
    channel = el.value;
    transformMode = channel.startsWith("g") ? "parent" : "self";
    selectedKey = null;
    expanded.add(selected);
    refresh();
    return;
  }
  if (el.dataset.bgColor) {
    commit(() => (object().colors[el.dataset.bgColor] = el.value));
    return;
  }
  if (el.id === "layerEnabled") {
    commit(() => {
      if (selected === "__audio__") ensureAudio().enabled = el.checked;
      else object().enabled = el.checked;
    });
    return;
  }
  if (!el.dataset.field) return;
  if (el.dataset.field.startsWith("project.")) {
    editProjectField(
      el.dataset.field.split(".")[1],
      el.type === "number" ? Number(el.value) : el.value,
    );
    return;
  }
  if (el.dataset.field.startsWith("earthMaterial.")) {
    const key = el.dataset.field.split(".")[1];
    const value =
      el.type === "checkbox"
        ? el.checked
        : el.type === "number"
          ? Number(el.value)
          : el.value;
    commit(() => {
      object().earthMaterial ??= {};
      object().earthMaterial[key] = value;
    }, selected);
    return;
  }
  if (el.dataset.field.startsWith("audio.")) {
    const key = el.dataset.field.split(".")[1],
      value = key === "name" ? el.value : Number(el.value);
    commit(() => (ensureAudio()[key] = key === "volume" ? value / 100 : value));
    return;
  }
  let [group, key] = el.dataset.field.split("."),
    value = ["number", "range"].includes(el.type) ? Number(el.value) : el.value;
  if (el.type === "number" && (!el.value || !Number.isFinite(value)))
    return refresh();
  if (group === "pivot" || group === "orbit") {
    rigEdit((o) => {
      if (group === "pivot" && key === "preset") {
        o.pivot.preset = value;
        return;
      }
      const a = group === "pivot" ? o.pivot.offset : o.orbit.center;
      if (o.links?.[group]) {
        let linked = linkedValues(a, +key, value);
        if (group === "pivot") o.pivot.offset = linked;
        else o.orbit.center = linked;
      } else a[+key] = value;
    });
    return;
  }
  if (group === "opacityPercent") {
    engine.previewMotion = null;
    if (value < 0 || value > 100) {
      refresh();
      return toast("不透明度范围为 0–100%", true);
    }
    play(false);
    commit(() => {
      editMotion("opacity", value / 100);
      expanded.add(selected);
      transformMode = "self";
    });
    return;
  }
  if (group === "keyOpacity") {
    if (value < 0 || value > 100) return refresh();
    const k = activeKey();
    if (!k) return;
    play(false);
    commit(() => editMotion("opacity", value / 100, k.time));
    return;
  }
  if (group === "revealPercent") {
    engine.previewMotion = null;
    if (value < 0 || value > 100) {
      refresh();
      return toast("显现进度范围为 0–100%", true);
    }
    play(false);
    commit(() => {
      editMotion("reveal", value / 100);
      expanded.add(selected);
      transformMode = "self";
    });
    return;
  }
  if (group === "keyReveal") {
    if (value < 0 || value > 100) return refresh();
    const k = activeKey();
    if (!k) return;
    play(false);
    commit(() => editMotion("reveal", value / 100, k.time));
    return;
  }
  if (group === "rotationAngle") {
    play(false);
    const o = object(),
      ch = el.dataset.rotationChannel,
      angles = rotationNumbers(o, ch, time);
    angles[Number(key)] = value;
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...angles.map(THREE.MathUtils.degToRad), "XYZ"),
    );
    rotationNumberCache.set(o.id + ":" + ch, {
      q: q.clone(),
      angles: angles.slice(),
    });
    commit(() => {
      addKey(o.id, ch, time, q.toArray());
      expanded.add(o.id);
    });
    return;
  }
  if (group === "motion") {
    play(false);
    commit(() => editMotion(key, value));
    return;
  }
  if (group === "key") {
    let k = activeKey();
    if (!k) return;
    commit(() => {
      if (key === "time") {
        const entries = selectionEntries();
        for (let entry of entries) {
          let ks = object().tracks[entry.channel];
          if (
            ks.some(
              (x) => x !== entry.key && Math.abs(x.time - value) < 0.00001,
            )
          )
            throw Error("同一通道在此时刻已有关键帧");
        }
        for (let entry of entries) {
          entry.key.time = value;
          object().tracks[entry.channel].sort((a, b) => a.time - b.time);
        }
        selectedKey.time = value;
        time = clamp(value, 0, project.duration);
      } else if (key === "value")
        editMotion(selectedKey.channel, value, k.time);
      else k[key] = value;
    });
    syncVideo();
    return;
  }
  let rebuild = ["text", "material", "geometry", "image", "adjust"].includes(
    group,
  )
    ? selected
    : false;
  commit(() => {
    let o = object();
    if (key) {
      if (group === "text" && key === "content") {
        value = value.replace(/[\r\n]/g, " ");
        engine.checkText(value);
      }
      if (group === "adjust")
        o.adjust ??= { hue: 0, saturation: 1, brightness: 1 };
      o[group][key] = value;
    } else o[group] = value;
  }, rebuild);
};
$("#inspector").onclick = (e) => {
  if (e.target.closest("#resetEarthMaterial")) {
    commit(() => delete object().earthMaterial, selected);
    return;
  }
  if (e.target.id === "replaceAudio") {
    $("#audioInput").click();
    return;
  }
  if (e.target.id === "resetAudio") {
    commit(() => delete project.audio);
    return;
  }
  if (e.target.id === "replaceImage") {
    pendingImageReplacement = selected;
    $("#imageInput").click();
    return;
  }
  const bevel = e.target.closest("[data-bevel]");
  if (bevel) {
    commit(() => {
      const p = object().text;
      p.bevelSize = bevel.dataset.bevel === "flat" ? 0 : 0.025;
      p.bevelThickness = p.bevelSize;
      p.bevelSegments = bevel.dataset.bevel === "round" ? 4 : 1;
    }, selected);
    return;
  }
  if (e.target.closest("[data-reset-appearance]")) {
    commit(() => delete object().adjust, selected);
    return;
  }
  if (["useTextSource", "useSvgSource"].includes(e.target.id)) {
    commit(() => {
      object().text.sourceMode =
        e.target.id === "useSvgSource" ? "svg" : "text";
    }, selected);
    return;
  }
  if (e.target.id === "uploadSvgSource") {
    pendingSvgTarget = { id: selected, project };
    $("#svgInput").click();
    return;
  }
  if (e.target.id === "logoToText") {
    commit(() => logoToText(object()), selected);
    return;
  }
  if (e.target.id === "opacityTrack") {
    channel = "opacity";
    transformMode = "self";
    selectedKey = null;
    expanded.add(selected);
    refresh();
    return;
  }
  if (e.target.id === "revealRetime") {
    retimeReveal();
    return;
  }
  if (e.target.id === "revealTrack") {
    channel = "reveal";
    transformMode = "self";
    selectedKey = null;
    expanded.add(selected);
    refresh();
    return;
  }
  if (e.target.id === "keyRotation") {
    play(false);
    commit(() =>
      addKey(
        selected,
        transformMode === "parent" ? "groupRotation" : "rotation",
      ),
    );
    return;
  }
  let lock = e.target.closest("[data-lock]");
  if (lock) {
    commit(() => {
      let o = object();
      o.links ??= {};
      o.links[lock.dataset.lock] = !o.links[lock.dataset.lock];
    });
    return;
  }
  let tab = e.target.closest("[data-rig-mode]");
  if (tab) {
    transformMode = tab.dataset.rigMode;
    channel = transformMode === "parent" ? "groupRotation" : "rotation";
    selectedKey = null;
    expanded.add(selected);
    refresh();
    return;
  }
  if (["centerEarth", "centerPivot", "centerWorld"].includes(e.target.id)) {
    let c = [0, 0, 0];
    if (e.target.id === "centerEarth") {
      let earth = project.objects.find((o) => o.type === "earth");
      if (!earth) return toast("工程里没有地球元素");
      let m = engine.pose(earth, time).matrix.elements;
      c = [m[12], m[13], m[14]];
    }
    if (e.target.id === "centerPivot")
      c = engine.pose(object(), time).pivotWorld.toArray();
    rigEdit((o) => (o.orbit.center = c));
    return;
  }
  if (e.target.id === "orbit360") {
    if (
      confirm(
        "在此元素可见区间内添加一圈 Y 轴公转？将替换现有父级 Y 旋转轨道，自身运动不变。",
      )
    ) {
      commit(() => {
        let o = object();
        o.tracks.groupRotation = Array.from({ length: 9 }, (_, i) => ({
          time: o.in + ((o.out - o.in) * i) / 8,
          value: new THREE.Quaternion()
            .setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i * Math.PI) / 4)
            .toArray(),
          easing: "linear",
        }));
        channel = "groupRotation";
        selectedKey = { id: o.id, channel: "groupRotation", time: o.in };
      });
      setTime(object().in);
    }
    return;
  }
  if (e.target.id === "resetParent") {
    if (
      confirm("清空父级位移、公转和缩放动画并恢复默认？自身轨道保留，可撤销。")
    )
      commit(() => {
        let o = object();
        for (let c of Object.keys(SCALAR_CHANNELS).filter((k) =>
          k.startsWith("g"),
        )) {
          o.base[c] = c.startsWith("gs") ? 1 : 0;
          delete o.tracks[c];
        }
        o.base.groupRotation = [0, 0, 0, 1];
        delete o.tracks.groupRotation;
        o.orbit.center = [0, 0, 0];
        selectedKey = null;
      });
    return;
  }
  let pin = e.target.closest("[data-pin]");
  if (pin) {
    play(false);
    commit(() => {
      addKey(selected, pin.dataset.pin);
      expanded.add(selected);
    });
    return;
  }
  if (e.target.id === "removeKey" && e.detail === 0) deleteSelectedKey();
  if (e.target.id === "fontBtn") $("#fontInput").click();
  if (e.target.id === "deleteObject" && !protectedObject(object())) {
    if (confirm(`删除“${object().name}”？可以通过撤销恢复。`))
      commit(() => {
        project.objects = project.objects.filter((o) => o.id !== selected);
        selected = project.objects[0].id;
        selectedKey = null;
      }, true);
  }
  if (["previousKey", "nextKey"].includes(e.target.id))
    jumpKey(e.target.id === "previousKey" ? -1 : 1, "channel");
};
$("#inspector").addEventListener("pointerdown", (e) => {
  if (e.target.closest("#removeKey")) {
    e.preventDefault();
    deleteSelectedKey();
  }
});
$("#timelineContent").onclick = (e) => {
  if (e.target.closest("#solo")) {
    solo = !solo;
    renderTimeline();
    frame();
    return;
  }
  if (dragging) return;
  if (e.target.id === "timelineContent") {
    select(null);
    return;
  }
  const eye = e.target.closest("[data-layer-eye]");
  if (eye) {
    commit(() => {
      const o = findObject(eye.dataset.layerEye);
      if (o.type !== "camera") o.enabled = !o.enabled;
    });
    return;
  }
  let ex = e.target.closest("[data-expand]");
  if (ex) {
    let id = ex.dataset.expand;
    expanded.has(id) ? expanded.delete(id) : expanded.add(id);
    renderTimeline();
    return;
  }
  let label = e.target.closest("[data-select]");
  if (label) {
    selected = label.dataset.select;
    keyNavigationScope = label.dataset.channel ? "channel" : "element";
    channel = label.dataset.channel || channel;
    transformMode = channel.startsWith("g") ? "parent" : "self";
    selectedKey = null;
    refresh();
  }
};
$("#timelineContent").onpointerdown = (e) => {
  if (e.target.closest("#solo")) return;
  if (e.button !== 0) return;
  if (e.target.closest("[data-layer-eye]")) return;
  let dot = e.target.closest("[data-key-id]");
  const clip = e.target.closest("[data-clip]");
  if (clip && !dot) {
    dragClip(e, clip);
    return;
  }
  let track = e.target.closest(".tl-track");
  if (!track) return;
  if (!dot) {
    if (e.detail > 1) return;
    play(false);
    let rect = track.getBoundingClientRect();
    if (track.dataset.track) {
      select(track.dataset.track);
      keyNavigationScope = track.dataset.channel ? "channel" : "element";
      if (track.dataset.channel) {
        channel = track.dataset.channel;
        transformMode = channel.startsWith("g") ? "parent" : "self";
      }
      refresh();
    }
    const seek = (x) => setTime((x - rect.left) / pps, { snap: true });
    seek(e.clientX);
    let move = (e) => seek(e.clientX),
      up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  $("#timelineScroll").focus({ preventScroll: true });
  play(false);
  let id = dot.dataset.keyId,
    ch = dot.dataset.keyChannel,
    t = +dot.dataset.keyTime,
    aggregate = dot.dataset.aggregate === "true",
    o = findObject(id),
    before = JSON.stringify(project),
    startX = e.clientX,
    moved = false;
  selected = id;
  channel = ch;
  transformMode = ch.startsWith("g") ? "parent" : "self";
  keyNavigationScope = aggregate ? "element" : "channel";
  selectedKey = { id, channel: ch, time: t, aggregate };
  let moving = [];
  for (let [c, ks] of Object.entries(o.tracks))
    for (let k of ks)
      if ((aggregate || c === ch) && Math.abs(k.time - t) < 1e-7)
        moving.push({ channel: c, key: k });
  setTime(t);
  renderInspector();
  renderObjects();
  renderTimeline();
  let move = (ev) => {
    if (Math.abs(ev.clientX - startX) < 3 && !moved) return;
    moved = true;
    dragging = true;
    let nt = clamp(t + (ev.clientX - startX) / pps, 0, project.duration);
    if ($("#snap").checked)
      nt = clamp(
        Math.round(nt * project.fps) / project.fps,
        0,
        project.duration,
      );
    nt = clamp(round(nt), 0, project.duration);
    if (
      moving.some((m) =>
        o.tracks[m.channel].some(
          (k) =>
            !moving.some((mm) => mm.key === k) &&
            Math.abs(k.time - nt) < 0.00001,
        ),
      )
    )
      return;
    moving.forEach((m) => {
      m.key.time = nt;
      o.tracks[m.channel].sort((a, b) => a.time - b.time);
    });
    selectedKey.time = nt;
    time = nt;
    workbench.invalidatePath();
    renderTimeline();
    frame();
  };
  let up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (moved && JSON.stringify(project) !== before) {
      validate(project);
      history(before);
    }
    refresh();
    syncVideo();
    setTimeout(() => (dragging = false), 0);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
};
$("#timelineContent").ondblclick = (e) => {
  if (e.target.closest(".diamond, .clip-bar")) return;
  let el = e.target.closest("[data-track]");
  if (!el) return;
  selected = el.dataset.track;
  channel = el.dataset.channel || channelEntries(object())[0]?.[0] || "";
  let rect = el.getBoundingClientRect();
  setTime((e.clientX - rect.left) / pps, { snap: true });
  commit(() => addKey());
};
$("#timelineScroll").onscroll = updatePlayhead;
$("#timelineScroll").addEventListener(
  "wheel",
  (e) => {
    const el = $("#timelineScroll");
    if (dragging) return;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      el.scrollLeft +=
        (e.deltaX || e.deltaY) *
        (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1);
      updatePlayhead();
      return;
    }
    if (e.clientX - el.getBoundingClientRect().left < labelWidth) return;
    e.preventDefault();
    let delta =
      e.deltaY *
      (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1);
    zoomTimeline(
      Number($("#zoom").value) * Math.exp(-clamp(delta, -160, 160) * 0.0025),
      e.clientX,
    );
  },
  { passive: false },
);
$("#prevKeyframe").onclick = () => jumpKey(-1);
$("#nextKeyframe").onclick = () => jumpKey(1);
$("#addKey").onclick = () => {
  play(false);
  commit(() => addKey());
};
$("#deleteKey").onclick = deleteSelectedKey;
$("#undo").onclick = () => restore(undoStack, redoStack);
$("#redo").onclick = () => restore(redoStack, undoStack);
$("#zoom").oninput = (e) => zoomTimeline(+e.target.value);
$("#play").onclick = () => play(!playing);
$("#prev").onclick = () => {
  play(false);
  setTime((Math.round(time * project.fps) - 1) / project.fps);
};
$("#next").onclick = () => {
  play(false);
  setTime((Math.round(time * project.fps) + 1) / project.fps);
};
$("#start").onclick = () => {
  play(false);
  setTime(0);
};
$("#timeInput").onchange = (e) => {
  play(false);
  setTime(Number(e.target.value) || 0);
};
$("#speed").onchange = (e) => {
  rate = +e.target.value;
  video.playbackRate = rate;
};
function referenceEnabled() {
  return $("#compare").checked || $("#overlayReference").checked;
}
function updateReferenceMode() {
  const overlay = $("#overlayReference").checked;
  $("#referenceStage").hidden = !referenceEnabled();
  $("#stageGrid").classList.toggle(
    "compare",
    $("#compare").checked && !overlay,
  );
  $("#stageGrid").classList.toggle("overlay-reference", overlay);
  $("#overlayControls").hidden = !overlay;
  $("#canvas").style.opacity = overlay
    ? Number($("#overlayOpacity").value) / 100
    : 1;
  $("#overlayOpacityLabel").textContent = $("#overlayOpacity").value + "%";
  fitStage();
  syncVideo();
  play(playing);
}
$("#compare").onchange = () => {
  if ($("#compare").checked) $("#overlayReference").checked = false;
  updateReferenceMode();
};
$("#overlayReference").onchange = () => {
  if ($("#overlayReference").checked) $("#compare").checked = false;
  updateReferenceMode();
};
$("#overlayOpacity").oninput = () => {
  $("#canvas").style.opacity = Number($("#overlayOpacity").value) / 100;
  $("#overlayOpacityLabel").textContent = $("#overlayOpacity").value + "%";
};
video.addEventListener("loadedmetadata", syncVideo);
$("#checker").onchange = (e) =>
  $("#renderStage").classList.toggle("checker", e.target.checked);
$("#showPivot").onchange = frame;
$("#showPath").checked = workbench.pathVisible;
$("#showPath").onchange = (e) => {
  workbench.pathVisible = e.target.checked;
  persistView();
  frame();
};
$("#canvas").addEventListener(
  "pointerdown",
  () => {
    rotationPointerUsed = false;
    activeViewport = "main";
  },
  true,
);
$("#canvas").addEventListener("pointerenter", () => {
  if (!gizmoSession) activeViewport = "main";
});
function screenPoint(e) {
  const r = $("#canvas").getBoundingClientRect(),
    s = 1080 / r.height;
  return new THREE.Vector3(
    (e.clientX - r.left - r.width / 2) * s,
    (r.top + r.height / 2 - e.clientY) * s,
    0,
  );
}
function updateScreenOutline() {
  let el = $("#screenOutline");
  if (!el) {
    el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    el.id = "screenOutline";
    el.classList.add("screen-outline");
    el.onpointerdown = (e) => {
      const h = e.target.closest("[data-screen-handle]");
      if (h) startScreenTransform(e, selected, h.dataset.screenHandle);
    };
    $("#renderStage").append(el);
  }
  const o = object(),
    node = engine.nodes.get(o.id);
  const show = isScreen(o) && node?.visible && !playing && gizmoEnabled;
  el.style.display = show ? "block" : "none";
  el.dataset.mode = workbench.mode;
  if (!show) return;
  const b = node.userData.bounds,
    m = engine.pose(o, time).matrix,
    W = (1080 * project.aspect[0]) / project.aspect[1],
    r = (6 * 1080) / Math.max(1, $("#canvas").getBoundingClientRect().height),
    cx = (b.min.x + b.max.x) / 2,
    cy = (b.min.y + b.max.y) / 2;
  const point = (x, y) => new THREE.Vector3(x, y, 0).applyMatrix4(m),
    svg = (p) => [p.x + W / 2, 540 - p.y];
  const handles = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
  ];
  const corners = [
    point(b.min.x, b.min.y),
    point(b.max.x, b.min.y),
    point(b.max.x, b.max.y),
    point(b.min.x, b.max.y),
  ];
  const top = point(cx, b.max.y),
    center = point(cx, cy),
    direction = top.clone().sub(center).normalize(),
    rotation = top.clone().addScaledVector(direction, r * 5),
    tp = svg(top),
    rp = svg(rotation);
  el.setAttribute("viewBox", `0 0 ${W} 1080`);
  const markup = `<polygon data-screen-handle="move" class="screen-selection-box" points="${corners.map((p) => svg(p).join(",")).join(" ")}"/><line class="screen-rotation-stem" x1="${tp[0]}" y1="${tp[1]}" x2="${rp[0]}" y2="${rp[1]}"/>${handles
    .map(([x, y]) => {
      const p = svg(
        point(
          x < 0 ? b.min.x : x > 0 ? b.max.x : cx,
          y < 0 ? b.min.y : y > 0 ? b.max.y : cy,
        ),
      );
      return `<rect class="screen-handle" data-screen-handle="${x},${y}" x="${p[0] - r}" y="${p[1] - r}" width="${r * 2}" height="${r * 2}" rx="${r * 0.25}" role="button" aria-label="缩放 ${x},${y}"><title>拖动缩放，Shift 等比</title></rect>`;
    })
    .join(
      "",
    )}<circle data-screen-handle="rotate" class="screen-rotate-handle" cx="${rp[0]}" cy="${rp[1]}" r="${r * 1.3}" role="button" aria-label="旋转"><title>拖动旋转，Shift 吸附 15°</title></circle>`;
  if (el._markup !== markup) {
    el.innerHTML = markup;
    el._markup = markup;
  }
}
function startScreenTransform(e, id, mode) {
  if (
    e.button !== 0 ||
    gizmoSession ||
    screenGesture ||
    !gizmoEnabled ||
    (mode === "move" && workbench.mode !== "translate")
  )
    return;
  const o = findObject(id);
  if (!isScreen(o)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  play(false);
  select(id);
  activeViewport = "main";
  const t = time,
    v = values(o, t),
    start = screenPoint(e),
    before = JSON.stringify(project),
    pose = engine.pose(o, t),
    matrix = pose.matrix.clone(),
    inverse = matrix.clone().invert(),
    bounds = engine.nodes.get(id).userData.bounds,
    pivot = pose.pivotWorld.clone();
  let moved = false,
    previousAngle = Math.atan2(start.y - pivot.y, start.x - pivot.x),
    turn = 0;
  const signs = mode.includes(",") ? mode.split(",").map(Number) : null;
  let anchor, handle, anchorWorld;
  if (signs) {
    const [x, y] = signs,
      cx = (bounds.min.x + bounds.max.x) / 2,
      cy = (bounds.min.y + bounds.max.y) / 2;
    anchor = new THREE.Vector3(
      x > 0 ? bounds.min.x : x < 0 ? bounds.max.x : cx,
      y > 0 ? bounds.min.y : y < 0 ? bounds.max.y : cy,
      0,
    );
    handle = new THREE.Vector3(
      x > 0 ? bounds.max.x : x < 0 ? bounds.min.x : cx,
      y > 0 ? bounds.max.y : y < 0 ? bounds.min.y : cy,
      0,
    );
    anchorWorld = anchor.clone().applyMatrix4(matrix);
  }
  const move = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    const p = screenPoint(ev);
    if (p.distanceTo(start) < 2 && !moved) return;
    moved = true;
    let next = {};
    if (mode === "move") {
      const d = p
        .clone()
        .sub(start)
        .applyMatrix3(new THREE.Matrix3().setFromMatrix4(pose.G).invert());
      next = { x: v.x + d.x, y: v.y + d.y };
    } else if (mode === "rotate") {
      const angle = Math.atan2(p.y - pivot.y, p.x - pivot.x);
      let delta = angle - previousAngle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      turn += delta;
      previousAngle = angle;
      let rz = v.rz + THREE.MathUtils.radToDeg(turn);
      if (ev.shiftKey) rz = Math.round(rz / 15) * 15;
      next = { rz };
    } else {
      const q = p.clone().applyMatrix4(inverse);
      let fx = signs[0] ? (q.x - anchor.x) / (handle.x - anchor.x) : 1,
        fy = signs[1] ? (q.y - anchor.y) / (handle.y - anchor.y) : 1;
      if (ev.shiftKey || o.links?.scale) {
        const f =
          signs[0] && signs[1]
            ? Math.abs(fx - 1) > Math.abs(fy - 1)
              ? fx
              : fy
            : signs[0]
              ? fx
              : fy;
        fx = fy = f;
      }
      fx = clamp(fx, 0.001 / v.sx, 100000 / v.sx);
      fy = clamp(fy, 0.001 / v.sy, 100000 / v.sy);
      next = { sx: v.sx * fx, sy: v.sy * fy, x: v.x, y: v.y };
      engine.previewMotion = { id, values: next };
      const actual = anchor.clone().applyMatrix4(engine.pose(o, t).matrix),
        d = anchorWorld
          .clone()
          .sub(actual)
          .applyMatrix3(new THREE.Matrix3().setFromMatrix4(pose.G).invert());
      next.x += d.x;
      next.y += d.y;
    }
    engine.previewMotion = { id, values: next };
  };
  const finish = (cancel) => {
    if (!screenGesture) return;
    screenGesture = null;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", abort);
    window.removeEventListener("blur", abort);
    const next = engine.previewMotion?.values;
    engine.previewMotion = null;
    if (moved && !cancel && next) {
      try {
        for (const [ch, value] of Object.entries(next))
          addKey(id, ch, t, value);
        validate(project);
        history(before);
      } catch (err) {
        project = JSON.parse(before);
        engine.load(project);
        toast(err.message, true);
      }
    }
    suppressCanvasClickUntil = performance.now() + 200;
    refresh();
  };
  const up = () => finish(false),
    abort = () => finish(true);
  screenGesture = finish;
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
  window.addEventListener("pointercancel", abort, { once: true });
  window.addEventListener("blur", abort, { once: true });
}
$("#canvas").addEventListener(
  "pointerdown",
  (e) => {
    const id = engine.pick(e.clientX, e.clientY);
    if (isScreen(findObject(id))) startScreenTransform(e, id, "move");
  },
  true,
);

$("#canvas").onclick = (e) => {
  if (rotationPointerUsed) {
    rotationPointerUsed = false;
    return;
  }
  if (
    gizmoSession ||
    performance.now() < suppressCanvasClickUntil ||
    engine.rotateControls.axis
  )
    return;
  let id = engine.pick(e.clientX, e.clientY);
  select(id || null);
};
async function saveParameters() {
  clearTimeout(saveTimer);
  const sequence = ++saveSequence;
  try {
    validate(project);
    await saveBrowserProject(project);
    if (sequence === saveSequence)
      $("#saveStatus").textContent = "参数已保存到本机";
  } catch (e) {
    if (sequence === saveSequence)
      $("#saveStatus").textContent = "保存失败：" + e.message;
    throw e;
  }
}
$("#exportBtn").onclick = async () => {
  try {
    await saveParameters();
    toast("参数已保存到本机");
  } catch (e) {
    toast("保存失败：" + e.message, true);
  }
};
$("#exitEditor").onclick = async () => {
  try {
    await saveParameters();
    location.href = "index.html";
  } catch (e) {
    if (
      confirm(
        "保存失败：" +
          e.message +
          "。\n未保存的修改可能丢失，仍要退出高级编辑吗？",
      )
    )
      location.href = "index.html";
    else toast("保存失败，暂未退出：" + e.message, true);
  }
};
$("#jsonBtn").onclick = () => {
  play(false);
  $("#jsonText").value = JSON.stringify(project, null, 2);
  $("#errorBox").textContent = "";
  $("#jsonModal").hidden = false;
};
function importProject(p) {
  validate(p);
  const old = JSON.stringify(project);
  try {
    engine.load(p);
    project = p;
    history(old);
    selected = findObject(selected)?.id || null;
    selectedKey = null;
    time = Math.min(time, project.duration);
    solo = false;
    refresh();
    syncVideo();
  } catch (e) {
    project = JSON.parse(old);
    engine.load(project);
    throw e;
  }
}
$("#applyJson").onclick = () => {
  try {
    importProject(JSON.parse($("#jsonText").value));
    $("#jsonModal").hidden = true;
    toast("JSON 校验通过，已应用");
  } catch (e) {
    $("#errorBox").textContent = e.message;
  }
};
$("#importBtn").onclick = () => $("#fileInput").click();
$("#fileInput").onchange = async (e) => {
  let file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 40000000) throw Error("配置文件不能超过 40 MB");
    play(false);
    importProject(JSON.parse(await file.text()));
    toast("工程已导入");
  } catch (err) {
    toast("导入失败：" + err.message, true);
  }
  e.target.value = "";
};
let pendingSvgTarget = null,
  svgUploadSequence = 0;
$("#svgInput").onchange = async (e) => {
  const file = e.target.files[0],
    target = pendingSvgTarget,
    sequence = ++svgUploadSequence;
  e.target.value = "";
  if (!file || !target) return;
  try {
    const svg = await readSvgFile(file);
    if (sequence !== svgUploadSequence || project !== target.project) return;
    const o = project.objects.find((o) => o.id === target.id);
    if (!o || !["text", "text2d"].includes(o.type)) return;
    if (
      commit(() => {
        o.text.svg = svg;
        o.text.sourceMode = "svg";
      }, o.id)
    )
      toast(
        o.type === "text2d"
          ? "SVG 已更新，原动画保持不变"
          : "SVG 已挤出，原动画与材质保持不变",
      );
  } catch (e) {
    toast(e.message, true);
  }
};
$("#fontInput").onchange = async (e) => {
  let file = e.target.files[0];
  if (!file) return;
  if (file.size > 20000000) {
    toast("字体大小上限为 20 MB", true);
    e.target.value = "";
    return;
  }
  let reader = new FileReader();
  reader.onload = () => {
    let next = clone(project);
    next.fontData = reader.result;
    try {
      importProject(next);
      toast("字体已更新，将随参数保存在本机");
    } catch (err) {
      toast("字体载入失败：" + err.message, true);
    }
  };
  reader.readAsDataURL(file);
  e.target.value = "";
};
let pendingImageReplacement = null;
$("#addImage").onclick = () => {
  pendingImageReplacement = null;
  $("#imageInput").click();
};
$("#projectSettings").onclick = () => select(null);
$("#themeToggle").onclick = () =>
  setTheme(
    document.documentElement.dataset.theme === "light" ? "dark" : "light",
  );
setTheme(document.documentElement.dataset.theme || "dark");
$("#audioInput").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  play(false);
  try {
    toast("正在读取音频…");
    const data = await readAudioFile(file);
    commit(() => {
      const a = ensureAudio();
      Object.assign(a, data, { offset: 0 });
      a.out = Math.min(project.duration, a.in + data.duration);
      if (a.out - a.in < 0.001) throw Error("音频片段太短");
    });
    select("__audio__");
    toast("音轨已替换");
  } catch (error) {
    toast(error.message, true);
  }
};
$("#imageInput").onchange = async (e) => {
  const file = e.target.files[0],
    replaceId = pendingImageReplacement;
  pendingImageReplacement = null;
  e.target.value = "";
  if (!file) return;
  try {
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 8 * 1024 * 1024
    )
      throw Error("请选择 8 MB 以内的 PNG、JPEG 或 WebP 图片");
    const bitmap = await createImageBitmap(file);
    if (bitmap.width > 8192 || bitmap.height > 8192) {
      bitmap.close();
      throw Error("图片尺寸上限为 8192 像素");
    }
    const width = bitmap.width,
      height = bitmap.height;
    bitmap.close();
    const src = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    if (replaceId) {
      const ok = commit(() => {
        const o = findObject(replaceId);
        if (!o || o.type !== "image") throw Error("目标图片已不存在");
        o.asset = { src };
        o.geometry.height = (o.geometry.width * height) / width;
      }, replaceId);
      if (ok) {
        select(replaceId);
        toast("图片已替换，保留动画与显示宽度，并匹配新图比例");
      }
    } else
      createScreenElement("image", { src, width, height, name: file.name });
    await engine.imagesReady();
  } catch (err) {
    toast(err.message, true);
  }
};
$("#addText2d").onclick = () => createScreenElement("text2d");
engine.onAssetError = (e) => toast("图片无法解码：" + e.message, true);
$("#addText").onclick = () => {
  commit(() => {
    let o = clone(
      migrate(clone(initial)).objects.find((o) => o.id === "headline"),
    );
    o.id = "text-" + Date.now().toString(36);
    o.name = "新建 3D 文字";
    o.userCreated = true;
    o.text.content = "新闻";
    o.text.size = 2;
    o.in = 0;
    o.out = project.duration;
    o.tracks = {};
    delete o.rotationReference;
    o.base = {
      x: 0,
      y: 0,
      z: 3,
      rx: 0,
      ry: 0,
      rz: 0,
      sx: 1,
      sy: 1,
      sz: 1,
      opacity: 1,
      reveal: 1,
      gx: 0,
      gy: 0,
      gz: 0,
      grx: 0,
      gry: 0,
      grz: 0,
      gsx: 1,
      gsy: 1,
      gsz: 1,
    };
    project.objects.push(o);
    selected = o.id;
    selectedKey = null;
    expanded.add(o.id);
  }, true);
};
$("#duplicate").onclick = () => {
  if (["camera", "background", "audio", "project"].includes(object().type))
    return;
  commit(() => {
    let o = clone(object());
    o.userCreated = true;
    o.id = o.type + "-" + Date.now().toString(36);
    o.name += " 副本";
    project.objects.push(o);
    selected = o.id;
    selectedKey = null;
  }, true);
};
function freshBackdrop() {
  const b = clone(BACKDROP_DEFAULT);
  for (const ks of Object.values(b.tracks))
    for (const k of ks)
      k.time = (k.time / 18.916666666666668) * project.duration;
  return b;
}
$("#openGenerator").onclick = async () => {
  const target = window.open("about:blank", "_blank");
  try {
    await saveParameters();
    if (target) target.location.href = "index.html";
    else toast("参数已保存；如新窗口被拦截，请点击“退出高级编辑”返回生成页。");
  } catch (e) {
    target?.close();
    toast("无法保存参数：" + e.message, true);
  }
};
$("#helpBtn").onclick = () => {
  $("#settingsName").value = project.name;
  $("#settingsDuration").value = project.duration;
  $("#settingsFps").value = project.fps;
  $("#helpModal").hidden = false;
};
$$("[data-close]").forEach(
  (b) => (b.onclick = () => ($("#" + b.dataset.close).hidden = true)),
);
$("#applySettings").onclick = () => {
  let d = +$("#settingsDuration").value,
    fps = +$("#settingsFps").value,
    oldDuration = project.duration;
  let ok = commit(() => {
    project.name = $("#settingsName").value || "未命名项目";
    project.duration = d;
    project.fps = fps;
    layers().forEach((o) => {
      if (Math.abs(o.out - oldDuration) < 0.001) o.out = d;
    });
  });
  if (ok) {
    time = Math.min(time, d);
    toast("项目设置已应用");
  }
};
$$("[data-example]").forEach(
  (button) =>
    (button.onclick = () => {
      if (
        !confirm(
          "载入示例会替换当前工程（可以撤销）。重要工程可先从 JSON 面板复制备份。继续？",
        )
      )
        return;
      play(false);
      let orbit = button.dataset.example === "orbit";
      importProject(clone(orbit ? orbitExample : flipExample));
      selected = "headline";
      transformMode = orbit ? "parent" : "self";
      channel = orbit ? "groupRotation" : "rotation";
      selectedKey = null;
      time = orbit ? 1 : 0.55;
      expanded = new Set();
      $("#showPivot").checked = true;
      $("#showPath").checked = true;
      workbench.pathVisible = true;
      $("#helpModal").hidden = true;
      refresh();
      syncVideo();
      toast("示例已载入：可播放或拖动时间轴查看两层运动");
    }),
);
$("#reset").onclick = () => {
  if (
    confirm(
      "恢复初始工程？当前工程可通过撤销找回；重要工程可先从 JSON 面板复制备份。",
    )
  ) {
    importProject(clone(initial));
    play(false);
    setTime(0);
    $("#helpModal").hidden = true;
    refresh();
    toast("已恢复初始工程");
  }
};
window.addEventListener("keydown", (e) => {
  if (screenGesture) {
    if (e.key === "Escape") {
      e.preventDefault();
      screenGesture(true);
    }
    return;
  }
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(
    document.activeElement.tagName,
  );
  if (
    !typing &&
    !$$(".modal").some((m) => !m.hidden) &&
    editViewOpen &&
    (activeViewport === "edit" || workbench.modal)
  ) {
    if (workbench.handleKey(e)) {
      e.preventDefault();
      return;
    }
  }
  if (gizmoSession) {
    e.preventDefault();
    if (e.key === "Escape") cancelRotationDrag();
    return;
  }
  if (e.key === "Escape") {
    const modalOpen = $$(".modal").some((m) => !m.hidden);
    $$(".modal").forEach((m) => (m.hidden = true));
    if (document.fullscreenElement && !modalOpen && !dragging) {
      document.exitFullscreen?.().catch(() => {});
      return;
    }
    if (!modalOpen && !typing && !dragging) select(null);
    return;
  }
  if (
    ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) ||
    $$(".modal").some((m) => !m.hidden)
  )
    return;
  const cmd = e.ctrlKey || e.metaKey;
  if (cmd && e.key.toLowerCase() === "z") {
    e.preventDefault();
    e.shiftKey ? restore(redoStack, undoStack) : restore(undoStack, redoStack);
    return;
  }
  if (cmd && e.key.toLowerCase() === "y") {
    e.preventDefault();
    restore(redoStack, undoStack);
    return;
  }
  if (["KeyG", "KeyR", "KeyS"].includes(e.code) && !cmd) {
    e.preventDefault();
    setSharedMode({ KeyG: "translate", KeyR: "rotate", KeyS: "scale" }[e.code]);
    return;
  }
  if (e.code === "KeyL") {
    e.preventDefault();
    workbench.setSpace(gizmoSpace === "local" ? "world" : "local");
    refresh();
    return;
  }
  if (e.code === "BracketLeft" || e.code === "BracketRight") {
    e.preventDefault();
    jumpKey(e.code === "BracketLeft" ? -1 : 1);
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    play(!playing);
  }
  if (e.code === "ArrowRight") {
    e.preventDefault();
    play(false);
    setTime(
      (Math.round(time * project.fps) + (e.shiftKey ? 10 : 1)) / project.fps,
    );
  }
  if (e.code === "ArrowLeft") {
    e.preventDefault();
    play(false);
    setTime(
      (Math.round(time * project.fps) - (e.shiftKey ? 10 : 1)) / project.fps,
    );
  }
  if (e.code === "Delete" || e.code === "Backspace") {
    e.preventDefault();
    deleteSelectedKey();
  }
});
function setSharedMode(mode) {
  if (gizmoSession) cancelRotationDrag();
  if (screenGesture) screenGesture(true);
  gizmoEnabled = true;
  workbench.setMode(mode);
  refresh();
}
$("#gizmoEnabledInput").onchange = (e) => {
  if (gizmoSession) cancelRotationDrag();
  if (screenGesture) screenGesture(true);
  gizmoEnabled = e.target.checked;
  frame();
};
$("#gizmoSpace").onchange = (e) => {
  if (gizmoSession) cancelRotationDrag();
  workbench.setSpace(e.target.value);
  refresh();
};
document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest("#displayOptions")) $("#displayOptions").open = false;
});
$("#displayOptions").addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.stopPropagation();
    $("#displayOptions").open = false;
    $("#displayOptions summary").focus();
  }
});
const mainView = {
  kind: "main",
  controls: engine.rotateControls,
  proxy: engine.rotationProxy,
  get state() {
    return engine.gizmoState;
  },
  finish() {},
  abort() {
    engine.cancelGizmo();
  },
};
function updateWorkbenchUI() {
  if (!$("#editView")) return;
  $("#viewToggle").classList.toggle("active", editViewOpen);
  $("#showPath").checked = workbench.pathVisible;
  $("#viewBadge").textContent = isScreen(object())
    ? "画面叠加 · 在主预览中拖动"
    : workbench.description();
  $("#viewProjection").textContent = workbench.camera.isOrthographicCamera
    ? "正交"
    : "透视";
  gizmoSpace = workbench.space;
  if (!engine.rotateControls.dragging) {
    engine.rotateControls.setMode(workbench.mode);
    engine.rotateControls.setSpace(
      workbench.mode === "scale" ? "local" : gizmoSpace,
    );
  }
  const spaceSelect = $("#gizmoSpace");
  spaceSelect.value = workbench.mode === "scale" ? "local" : gizmoSpace;
  spaceSelect.disabled = workbench.mode === "scale";
  spaceSelect.title =
    workbench.mode === "scale"
      ? "缩放沿局部轴执行，移动和旋转可选择坐标系"
      : "双视图坐标系";
  $$("[data-view-mode]").forEach(
    (b) => (
      b.classList.toggle("active", b.dataset.viewMode === workbench.mode),
      b.setAttribute(
        "aria-pressed",
        String(b.dataset.viewMode === workbench.mode),
      )
    ),
  );
  $("#viewTransformHud").hidden = !workbench.modal;
  if (workbench.modal)
    $("#viewTransformHud").textContent = workbench.description();
}
function persistView() {
  try {
    localStorage.setItem(
      "motion-workbench-ui",
      JSON.stringify({
        open: editViewOpen,
        width: viewWidth,
        path: workbench.pathVisible,
        inspectorOpen,
        timelineHeight,
      }),
    );
  } catch (_) {}
}
function showWorkbench(show, persist = true) {
  if (!show && gizmoSession?.view === workbench) cancelRotationDrag();
  editViewOpen = show;
  $(".app").classList.toggle("with-edit-view", show);
  $(".app").style.setProperty("--edit-view-width", viewWidth + "px");
  $("#editView").hidden = !show;
  workbench.setVisible(show);
  if (!show) activeViewport = "main";
  else activeViewport = "edit";
  if (persist) persistView();
  fitStage();
  renderTimeline();
  updateWorkbenchUI();
}
function transformStart(view) {
  if (!view.state) return;
  if (gizmoSession) cancelRotationDrag();
  play(false);
  const state = view.state;
  selected = state.id;
  const mode = view.controls.mode || "rotate",
    parent =
      (state.target || transformMode) === "parent" ||
      state.channel === "groupRotation";
  channel =
    mode === "rotate"
      ? parent
        ? "groupRotation"
        : "rotation"
      : mode === "scale"
        ? parent
          ? "gsx"
          : "sx"
        : parent
          ? "gx"
          : "x";
  const o = object(),
    pose = engine.pose(o, time);
  gizmoSession = {
    view,
    id: selected,
    mode,
    parent,
    channel,
    time,
    before: JSON.stringify(project),
    values: engine.motionValues(o, time),
    G: pose.G.clone(),
    position: view.proxy.position.clone(),
    quaternion: view.proxy.quaternion.clone(),
    scale: view.proxy.scale.clone(),
    start: engine
      .rotation(o, parent ? "groupRotation" : "rotation", time)
      .clone(),
  };
  if (view.kind === "main") {
    rotationPointerUsed = true;
    suppressCanvasClickUntil = Infinity;
  } else {
    activeViewport = "edit";
    workbench.pointerUsed = true;
  }
  $("#engineStatus").textContent =
    "正在" +
    ({ translate: "移动", rotate: "旋转", scale: "缩放" }[mode] || "编辑") +
    " · Enter 确认 / Esc 取消";
}
function transformChange(view) {
  const session = gizmoSession;
  if (!session || session.view !== view) return;
  const o = project.objects.find((o) => o.id === session.id),
    fine = workbench.fine && !view.modal;
  if (session.mode === "rotate") {
    if (fine)
      view.proxy.quaternion.copy(
        session.quaternion.clone().slerp(view.proxy.quaternion, 0.1),
      );
    const q = engine.gizmoValue(o, session.channel, session.time, view.proxy);
    engine.previewRotation = { id: o.id, channel: session.channel, value: q };
    const a = THREE.MathUtils.radToDeg(view.controls.rotationAngle || 0);
    let readout = $("#rotationReadout");
    if (readout)
      readout.textContent = `${view.controls.axis || ""} ${a.toFixed(2)}° · ${view.kind === "edit" ? "3D 视图" : gizmoSpace === "local" ? "局部" : "世界"}`;
  } else {
    let next = {};
    if (session.mode === "translate") {
      let delta = view.proxy.position.clone().sub(session.position);
      if (fine) {
        delta.multiplyScalar(0.1);
        view.proxy.position.copy(session.position).add(delta);
      }
      if (!session.parent)
        delta.applyMatrix3(
          new THREE.Matrix3().setFromMatrix4(session.G).invert(),
        );
      let names = session.parent ? ["gx", "gy", "gz"] : ["x", "y", "z"];
      names.forEach(
        (c, i) => (next[c] = session.values[c] + delta.getComponent(i)),
      );
    } else {
      let scale = view.proxy.scale.clone();
      if (fine) scale.sub(session.scale).multiplyScalar(0.1).add(session.scale);
      let names = session.parent ? ["gsx", "gsy", "gsz"] : ["sx", "sy", "sz"];
      names.forEach(
        (c, i) => (next[c] = Math.max(0.001, scale.getComponent(i))),
      );
      view.proxy.scale.set(...names.map((c) => next[c]));
    }
    engine.previewMotion = { id: o.id, values: next };
  }
  updateWorkbenchUI();
}
function transformEnd(view) {
  let session = gizmoSession;
  if (!session || session.view !== view) return;
  const quaternion = engine.previewRotation?.value.clone(),
    motion = engine.previewMotion ? { ...engine.previewMotion.values } : null,
    changed =
      session.mode === "rotate"
        ? quaternion && session.start.angleTo(quaternion) > 1e-7
        : motion &&
          Object.entries(motion).some(
            ([c, v]) => Math.abs(v - session.values[c]) > 1e-7,
          );
  gizmoSession = null;
  engine.previewRotation = null;
  engine.previewMotion = null;
  view.finish?.();
  suppressCanvasClickUntil = performance.now() + 250;
  if (changed) {
    try {
      if (session.mode === "rotate")
        addKey(session.id, session.channel, session.time, quaternion.toArray());
      else {
        Object.entries(motion).forEach(([c, v]) =>
          addKey(session.id, c, session.time, v),
        );
        channel = session.channel;
        selectedKey = {
          id: session.id,
          channel,
          time: clamp(round(session.time), 0, project.duration),
        };
      }
      validate(project);
      history(session.before);
      expanded.add(session.id);
      toast(
        "已记录" +
          { translate: "位置", rotate: "旋转", scale: "缩放" }[session.mode] +
          "关键帧",
      );
    } catch (e) {
      project = JSON.parse(session.before);
      engine.load(project);
      toast(e.message, true);
    }
  }
  refresh();
  $("#engineStatus").textContent = "WEBGL READY · 双视图编辑";
}
function cancelRotationDrag() {
  if (!gizmoSession) return;
  const view = gizmoSession.view;
  view.abort?.();
  gizmoSession = null;
  engine.previewRotation = null;
  engine.previewMotion = null;
  suppressCanvasClickUntil = performance.now() + 250;
  refresh();
  toast("本次变换已取消");
}
engine.rotateControls.addEventListener("mouseDown", () =>
  transformStart(mainView),
);
engine.rotateControls.addEventListener("objectChange", () =>
  transformChange(mainView),
);
engine.rotateControls.addEventListener("mouseUp", () => transformEnd(mainView));
workbench.setCallbacks({
  start: transformStart,
  change: transformChange,
  end: transformEnd,
  cancel: cancelRotationDrag,
  activate: () => {
    activeViewport = "edit";
  },
  select: (id) => {
    if (id) select(id);
  },
  ui: updateWorkbenchUI,
});
$("#editCanvas").addEventListener("pointerenter", () => {
  if (!gizmoSession) activeViewport = "edit";
});
$("#canvas").addEventListener("pointercancel", cancelRotationDrag);
window.addEventListener("blur", cancelRotationDrag);
// Browser fullscreen is a view setting, not part of the animation project.
function syncFullscreenButton() {
  const full = !!document.fullscreenElement;
  const button = $("#fullscreenToggle");
  const label = full ? "退出全屏" : "全屏";
  button.innerHTML =
    icon(full ? "fullscreen-exit-line" : "fullscreen-line") + " " + label;
  button.setAttribute("aria-pressed", String(full));
  button.setAttribute("aria-label", label);
  button.title = full ? "退出全屏（Esc）" : "全屏显示编辑器（Esc 退出）";
}
$("#fullscreenToggle").onclick = async () => {
  try {
    if (document.fullscreenElement) {
      if (!document.exitFullscreen) throw Error("当前页面不支持退出全屏");
      await document.exitFullscreen();
    } else {
      if (
        !document.fullscreenEnabled ||
        !document.documentElement.requestFullscreen
      )
        throw Error("当前浏览器或嵌入页面不允许全屏");
      await document.documentElement.requestFullscreen();
    }
  } catch (error) {
    toast("无法切换全屏：" + (error.message || "请检查浏览器权限"), true);
  }
  syncFullscreenButton();
};
document.addEventListener("fullscreenchange", syncFullscreenButton);
syncFullscreenButton();

function setInspectorOpen(open, persist = true) {
  inspectorOpen = !!open;
  $(".app").classList.toggle("inspector-collapsed", !inspectorOpen);
  const button = $("#inspectorToggle"),
    label = inspectorOpen ? "收起属性面板" : "展开属性面板";
  button.innerHTML = icon(
    inspectorOpen ? "arrow-right-s-line" : "arrow-left-s-line",
  );
  button.setAttribute("aria-expanded", String(inspectorOpen));
  button.setAttribute("aria-label", label);
  button.title = label;
  if (persist) persistView();
  fitStage();
}
$("#inspectorToggle").onclick = () => setInspectorOpen(!inspectorOpen);

function timelineBounds() {
  const available = $(".app").clientHeight;
  return { min: 160, max: Math.max(160, available - 44 - 220) };
}
function setTimelineHeight(height, persist = false) {
  const { min, max } = timelineBounds();
  timelineHeight = Math.round(clamp(height, min, max));
  $(".app").style.setProperty("--timeline-height", timelineHeight + "px");
  const handle = $("#timelineResize");
  handle.setAttribute("aria-valuemin", String(min));
  handle.setAttribute("aria-valuemax", String(max));
  handle.setAttribute("aria-valuenow", String(timelineHeight));
  if (persist) persistView();
}
const timelineHandle = $("#timelineResize");
let timelineDrag = null;
timelineHandle.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || timelineDrag) return;
  event.preventDefault();
  timelineDrag = {
    id: event.pointerId,
    y: event.clientY,
    height: timelineHeight,
  };
  document.body.classList.add("resizing-timeline");
  timelineHandle.setPointerCapture(event.pointerId);
});
timelineHandle.addEventListener("pointermove", (event) => {
  if (!timelineDrag || event.pointerId !== timelineDrag.id) return;
  event.preventDefault();
  setTimelineHeight(timelineDrag.height + timelineDrag.y - event.clientY);
});
function finishTimelineDrag(event) {
  if (!timelineDrag || event.pointerId !== timelineDrag.id) return;
  timelineDrag = null;
  document.body.classList.remove("resizing-timeline");
  if (timelineHandle.hasPointerCapture(event.pointerId))
    timelineHandle.releasePointerCapture(event.pointerId);
  persistView();
}
timelineHandle.addEventListener("pointerup", finishTimelineDrag);
timelineHandle.addEventListener("pointercancel", finishTimelineDrag);
timelineHandle.addEventListener("lostpointercapture", finishTimelineDrag);
timelineHandle.addEventListener("dblclick", () => setTimelineHeight(330, true));
timelineHandle.addEventListener("keydown", (event) => {
  let height = timelineHeight;
  const step = event.shiftKey ? 50 : 20;
  if (event.key === "ArrowUp") height += step;
  else if (event.key === "ArrowDown") height -= step;
  else if (event.key === "Home") height = timelineBounds().min;
  else if (event.key === "End") height = timelineBounds().max;
  else return;
  event.preventDefault();
  event.stopPropagation();
  setTimelineHeight(height, true);
});
new ResizeObserver(() => setTimelineHeight(timelineHeight)).observe($(".app"));
setTimelineHeight(timelineHeight);
setInspectorOpen(inspectorOpen, false);

$("#viewToggle").onclick = () => showWorkbench(!editViewOpen);
$("#viewClose").onclick = () => showWorkbench(false);
$$("[data-view-mode]").forEach(
  (b) =>
    (b.onclick = () => {
      setSharedMode(b.dataset.viewMode);
    }),
);
$$("[data-view]").forEach(
  (b) =>
    (b.onclick = () => {
      showWorkbench(true);
      workbench.setView(b.dataset.view);
    }),
);
$("#viewProjection").onclick = () => {
  showWorkbench(true);
  workbench.toggleProjection();
};
$("#viewFrame").onclick = () => {
  showWorkbench(true);
  workbench.frameSelected();
};
$("#viewCamera").onclick = () => {
  showWorkbench(true);
  workbench.cameraView();
};
$("#viewGrid").onchange = (e) => (workbench.gridVisible = e.target.checked);
$("#viewFramePath").onclick = () => {
  showWorkbench(true);
  workbench.pathVisible = true;
  $("#showPath").checked = true;
  workbench.framePath();
  persistView();
};
$("#viewFrustum").onchange = (e) =>
  (workbench.cameraVisible = e.target.checked);
$("#viewAll").onchange = (e) => (workbench.showAll = e.target.checked);
$("#viewDivider").onpointerdown = (e) => {
  e.preventDefault();
  let start = e.clientX,
    width = $("#editView").getBoundingClientRect().width;
  let move = (ev) => {
    viewWidth = clamp(
      width + start - ev.clientX,
      260,
      Math.max(
        280,
        Math.min(
          700,
          window.innerWidth -
            $(".objects").offsetWidth -
            $(".inspector").offsetWidth -
            280,
        ),
      ),
    );
    $(".app").style.setProperty("--edit-view-width", viewWidth + "px");
  };
  let up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    persistView();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
};
new ResizeObserver(() => workbench.resize()).observe($("#viewCanvasWrap"));
showWorkbench(editViewOpen, false);
function sharedModifiers(e) {
  workbench.updateModifiers(e);
  engine.rotateControls.setTranslationSnap(e.ctrlKey ? 1 : null);
  engine.rotateControls.setScaleSnap(e.ctrlKey ? 0.1 : null);
  workbench.controls.setRotationSnap(
    (((e.ctrlKey ? 5 : gizmoSnap) || 0) * Math.PI) / 180 || null,
  );
}
window.addEventListener("keydown", sharedModifiers, true);
window.addEventListener("keyup", sharedModifiers);

$("#editorBgm").addEventListener("loadedmetadata", syncMusic);
let musicClock = 0;
let last = performance.now(),
  elapsedCheck = 0;
function tick(now) {
  const dt = (now - last) / 1000;
  last = now;
  musicClock += dt;
  if (musicClock > 0.3) {
    syncMusic();
    musicClock = 0;
  }
  if (playing) {
    time += dt * rate;
    if (time >= project.duration) {
      if ($("#loop").checked) {
        time %= project.duration;
        syncVideo();
        play(true);
      } else {
        time = project.duration;
        play(false);
      }
    }
    elapsedCheck += dt;
    if (referenceEnabled() && elapsedCheck > 0.3) {
      elapsedCheck = 0;
      if (time >= video.duration) {
        video.pause();
        syncVideo();
      } else if (Math.abs(video.currentTime - time) > 0.15) syncVideo();
    }
  }
  frame();
  requestAnimationFrame(tick);
}
new ResizeObserver(() => {
  fitStage();
  renderTimeline();
}).observe($("#previewSpace"));
new ResizeObserver(renderTimeline).observe($("#timelineScroll"));
refresh();
requestAnimationFrame(tick);
$("#engineStatus").textContent = "WEBGL READY · 双视图编辑";
$("#saveStatus").textContent = "● 工程就绪";
if (initNotice) toast(initNotice);
window.motionEditor = {
  workbench,
  getProject: () => clone(project),
  getTime: () => time,
  seek: (t) => setTime(t),
  select: (id) => select(id),
  importProject,
  engine,
  sample,
  validate,
};
