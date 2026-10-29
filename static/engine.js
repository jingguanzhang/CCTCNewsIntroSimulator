import { smoothExtrusion } from "./smooth-normals.js";
import { earthMaterial, validateEarthMaterial } from "./earth-material.js";
import { validateSvg, svgGeometry } from "./svg-geometry.js";
import { validateAudio } from "./audio-track.js";
import { isScreen, applyAdjustment } from "./appearance.js";
import { glyphShapes } from "./glyph-shapes.js";
import { BroadcastBackground } from "./background.js";
import * as THREE from "./vendor/three/three.module.js";
import * as opentype from "./vendor/opentype/opentype.mjs";
import { TransformControls } from "./vendor/three/addons/controls/TransformControls.js";
const rad = Math.PI / 180;
const RIBBON_ASPECT = {
  red: 3799 / 2594,
  green: 3795 / 2594,
  blue: 3226 / 3341,
};
function migrateRibbon(o) {
  if (o.type !== "ribbon" || o.image) return;
  const color =
    o.id === "ribbon-1" ? "blue" : o.id === "ribbon-2" ? "green" : "red";
  o.image = color;
  if (o.geometry) o.geometry.height = o.geometry.width / RIBBON_ASPECT[color];
}

export const CHANNELS = {
  x: "位置 X",
  y: "位置 Y",
  z: "位置 Z",
  rx: "旋转 X",
  ry: "旋转 Y",
  rz: "旋转 Z",
  sx: "缩放 X",
  sy: "缩放 Y",
  sz: "缩放 Z",
  opacity: "不透明度",
  reveal: "文字揭示",
  normalSpin: "沿正面法向旋转",
  gx: "父级位移 X",
  gy: "父级位移 Y",
  gz: "父级位移 Z",
  grx: "父级公转 X",
  gry: "父级公转 Y",
  grz: "父级公转 Z",
  gsx: "父级缩放 X",
  gsy: "父级缩放 Y",
  gsz: "父级缩放 Z",
};
export const PIVOTS = {
  center: "模型中心",
  bottom: "底边中心",
  top: "顶边中心",
  left: "左边中心",
  right: "右边中心",
  front: "正面中心",
  back: "背面中心",
  custom: "自定义（模型原点）",
};
export function migrate(p) {
  if (p?.version === 1) {
    p.version = 2;
    for (let o of p.objects || []) {
      o.pivot = { preset: "custom", offset: [0, 0, 0] };
      o.orbit = { center: [0, 0, 0] };
      Object.assign(o.base, {
        gx: 0,
        gy: 0,
        gz: 0,
        grx: 0,
        gry: 0,
        grz: 0,
        gsx: 1,
        gsy: 1,
        gsz: 1,
      });
    }
  }
  if (p?.version === 2) p.version = 3;
  if (p?.version === 3)
    for (let o of p.objects || [])
      if (o.base && o.base.normalSpin === undefined) o.base.normalSpin = 0;
  if (p?.version === 3) for (let o of p.objects || []) migrateRibbon(o);
  return p;
}
export const EASINGS = {
  linear: "线性",
  smooth: "平滑",
  easeIn: "加速",
  easeOut: "减速",
  easeInOut: "缓入缓出",
  step: "保持",
};
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function sample(keys, t, fallback = 0) {
  if (!keys?.length) return fallback;
  if (t <= keys[0].time) return keys[0].value;
  for (let i = 1; i < keys.length; i++) {
    let a = keys[i - 1],
      b = keys[i];
    if (t <= b.time) {
      let u = (t - a.time) / (b.time - a.time);
      switch (a.easing) {
        case "step":
          u = u >= 1 ? 1 : 0;
          break;
        case "smooth":
          u = u * u * (3 - 2 * u);
          break;
        case "easeIn":
          u = u * u;
          break;
        case "easeOut":
          u = 1 - (1 - u) ** 2;
          break;
        case "easeInOut":
          u = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
          break;
      }
      return a.value + (b.value - a.value) * u;
    }
  }
  return keys.at(-1).value;
}
export function values(o, t) {
  return Object.fromEntries(
    Object.keys(CHANNELS).map((k) => [k, sample(o.tracks[k], t, o.base[k])]),
  );
}
export const QUAT_CHANNELS = {
  rotation: "对象旋转",
  groupRotation: "父级旋转",
};
export function ease(u, type) {
  if (type === "step") return u >= 1 ? 1 : 0;
  if (type === "smooth") return u * u * (3 - 2 * u);
  if (type === "easeIn") return u * u;
  if (type === "easeOut") return 1 - (1 - u) ** 2;
  if (type === "easeInOut")
    return u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
  return u;
}
export function sampleQuaternion(keys, t, base = [0, 0, 0, 1]) {
  if (!keys?.length) return new THREE.Quaternion().fromArray(base).normalize();
  if (t <= keys[0].time)
    return new THREE.Quaternion().fromArray(keys[0].value).normalize();
  for (let i = 1; i < keys.length; i++) {
    let a = keys[i - 1],
      b = keys[i];
    if (t <= b.time)
      return new THREE.Quaternion()
        .fromArray(a.value)
        .normalize()
        .slerp(
          new THREE.Quaternion().fromArray(b.value).normalize(),
          ease((t - a.time) / (b.time - a.time), a.easing),
        );
  }
  return new THREE.Quaternion().fromArray(keys.at(-1).value).normalize();
}
function frameQuaternion(matrix) {
  let z = new THREE.Vector3(0, 0, 1).applyNormalMatrix(
      new THREE.Matrix3().getNormalMatrix(matrix),
    ),
    x = new THREE.Vector3(1, 0, 0).transformDirection(matrix),
    y = new THREE.Vector3().crossVectors(z, x).normalize();
  return new THREE.Quaternion()
    .setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
    .normalize();
}
function validQuaternion(q) {
  if (
    !Array.isArray(q) ||
    q.length !== 4 ||
    q.some((v) => typeof v !== "number" || !Number.isFinite(v)) ||
    Math.abs(Math.hypot(...q) - 1) > 0.001
  )
    throw Error("旋转四元数必须为归一化的 [x,y,z,w]");
}
function finite(v, min, max, label) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    throw Error(`${label} 必须在 ${min} 至 ${max} 之间`);
}
function validateBackdrop(b, duration) {
  if (b === undefined) return;
  if (!b || typeof b.enabled !== "boolean" || b.style !== "blue-rays")
    throw Error("背景配置无效");
  if (b.in !== undefined) finite(b.in, 0, duration, "背景入点");
  if (b.out !== undefined)
    finite(b.out, (b.in ?? 0) + 0.001, duration + 0.001, "背景出点");
  for (let k of ["dark", "blue", "light"])
    if (!/^#[0-9a-f]{6}$/i.test(b.colors?.[k])) throw Error("背景颜色无效");
  const limits = {
    intensity: [0, 5],
    rotation: [-100000, 100000],
    travel: [-100000, 100000],
    centerX: [-2, 3],
    centerY: [-2, 3],
    particles: [0, 5],
  };
  for (let [k, [lo, hi]] of Object.entries(limits))
    finite(b.base?.[k], lo, hi, "背景 " + k);
  if (!b.tracks || typeof b.tracks !== "object") throw Error("背景缺少 tracks");
  for (let [k, ks] of Object.entries(b.tracks)) {
    if (!limits[k] || !Array.isArray(ks) || ks.length > 2000)
      throw Error("无效的背景通道");
    let last = -1;
    for (let key of ks) {
      finite(key.time, 0, duration, "背景帧时间");
      finite(key.value, ...limits[k], "背景帧数值");
      if (key.time <= last || !EASINGS[key.easing])
        throw Error("背景关键帧顺序 / 缓动无效");
      last = key.time;
    }
  }
}
export function validate(p) {
  validateAudio(p);
  migrate(p);
  if (!p || p.version !== 3)
    throw Error("不支持的配置版本（支持 1 / 2 自动升级至 3）");
  if (typeof p.name !== "string") throw Error("缺少项目名称");
  finite(p.duration, 0.1, 300, "时长");
  finite(p.fps, 1, 120, "帧率");
  if (!Number.isInteger(p.fps)) throw Error("帧率必须为整数");
  if (!Array.isArray(p.aspect) || p.aspect.length !== 2)
    throw Error("缺少画幅比例");
  p.aspect.forEach((v) => finite(v, 1, 100, "画幅比例"));
  if (
    !Array.isArray(p.objects) ||
    p.objects.length < 1 ||
    p.objects.length > 50
  )
    throw Error("元素数量必须为 1–50");
  let ids = new Set();
  let cameras = 0;
  for (let o of p.objects) {
    if (typeof o.id !== "string" || !o.id || ids.has(o.id))
      throw Error("元素 ID 必须唯一");
    ids.add(o.id);
    if (typeof o.name !== "string" || typeof o.enabled !== "boolean")
      throw Error("元素名称 / 启用状态格式错误");
    if (
      ![
        "text",
        "text2d",
        "image",
        "earth",
        "ribbon",
        "logo",
        "camera",
      ].includes(o.type)
    )
      throw Error("不支持的元素类型");
    finite(o.in, 0, p.duration, "入点");
    finite(o.out, o.in + 0.001, p.duration + 0.001, "出点");
    if (!o.base || !o.tracks) throw Error("缺少 base / tracks");
    if (o.links !== undefined) {
      if (!o.links || typeof o.links !== "object" || Array.isArray(o.links))
        throw Error("links 必须为属性组开关对象");
      for (let [g, v] of Object.entries(o.links))
        if (
          ![
            "position",
            "rotation",
            "scale",
            "groupPosition",
            "groupRotation",
            "groupScale",
            "pivot",
            "orbit",
          ].includes(g) ||
          typeof v !== "boolean"
        )
          throw Error("无效的比例锁配置");
    }
    if (!o.pivot || !Object.hasOwn(PIVOTS, o.pivot.preset))
      throw Error("无效的旋转支点");
    for (let [label, a] of [
      ["支点偏移", o.pivot.offset],
      ["父级中心", o.orbit?.center],
    ]) {
      if (!Array.isArray(a) || a.length !== 3)
        throw Error(label + " 必须为 XYZ 数组");
      a.forEach((v) => finite(v, -100000, 100000, label));
    }
    for (let k of Object.keys(QUAT_CHANNELS))
      if (o.base[k] !== undefined) validQuaternion(o.base[k]);
    if (o.rotationReference) {
      if (!o.rotationReference.base || !o.rotationReference.tracks)
        throw Error("缺少旧旋转参考数据");
      for (let c of ["rx", "ry", "rz", "normalSpin"]) {
        finite(o.rotationReference.base[c], -100000, 100000, "旧旋转参考");
        let last = -1;
        for (let k of o.rotationReference.tracks[c] || []) {
          finite(k.time, 0, 300, "参考时间");
          finite(k.value, -100000, 100000, "参考角度");
          if (k.time <= last || !EASINGS[k.easing])
            throw Error("旧旋转参考关键帧格式错误");
          last = k.time;
        }
      }
    }
    for (let k in CHANNELS)
      finite(
        o.base[k],
        k === "opacity" || k === "reveal"
          ? 0
          : /^g?s[xyz]$/.test(k)
            ? 0.001
            : -100000,
        k === "opacity" || k === "reveal" ? 1 : 100000,
        k,
      );
    for (let [k, ks] of Object.entries(o.tracks)) {
      if (
        (!CHANNELS[k] && !QUAT_CHANNELS[k]) ||
        !Array.isArray(ks) ||
        ks.length > (QUAT_CHANNELS[k] ? 8192 : 2000)
      )
        throw Error("无效的运动通道");
      let last = -1;
      for (let key of ks) {
        finite(key.time, 0, p.duration, "关键帧时间");
        if (QUAT_CHANNELS[k]) validQuaternion(key.value);
        else
          finite(
            key.value,
            k === "opacity" || k === "reveal"
              ? 0
              : /^g?s[xyz]$/.test(k)
                ? 0.001
                : -100000,
            k === "opacity" || k === "reveal" ? 1 : 100000,
            "关键帧数值",
          );
        if (key.time <= last) throw Error("关键帧须按时间升序排列，且不可重叠");
        last = key.time;
        if (!EASINGS[key.easing]) throw Error("未知缓动类型");
      }
    }
    if (["text", "text2d"].includes(o.type)) {
      if (
        !o.text ||
        typeof o.text.content !== "string" ||
        o.text.content.length > 100
      )
        throw Error("文字长度上限为 100 字");
      validateSvg(o.text, o.type);
      for (let [k, a, b] of [
        ["size", 0.05, 20],
        ["tracking", -5, 20],
        ["depth", 0, 10],
        ["bevelSize", 0, 1],
        ["bevelThickness", 0, 1],
        ["bevelSegments", 1, 8],
        ["curveSegments", 2, 16],
      ])
        finite(
          o.text[k],
          a,
          o.type === "text2d" && k === "size" ? 500 : b,
          "文字 " + k,
        );
      if (
        !Number.isInteger(o.text.bevelSegments) ||
        !Number.isInteger(o.text.curveSegments)
      )
        throw Error("分段数须为整数");
    }
    if (o.type === "earth") validateEarthMaterial(o);
    if (["text", "text2d", "ribbon", "logo"].includes(o.type)) {
      if (!o.material) throw Error("缺少材质");
      for (let k of ["color", "sideColor"])
        if (!/^#[0-9a-f]{6}$/i.test(o.material[k]))
          throw Error("颜色须为 #RRGGBB");
      for (let k of ["metalness", "roughness"]) finite(o.material[k], 0, 1, k);
    }
    if (o.type === "ribbon" && !Object.hasOwn(RIBBON_ASPECT, o.image))
      throw Error("无效的彩条图片素材");
    if (o.type === "ribbon")
      for (let k of ["width", "height", "depth"])
        finite(o.geometry?.[k], 0.01, 100, "条带 " + k);
    if (o.type === "logo") {
      finite(o.geometry?.depth, 0, 10, "标识厚度");
      finite(o.geometry?.bevelSize, 0, 1, "标识倒角");
    }
    if (o.adjust) {
      finite(o.adjust.hue, -180, 180, "色相");
      finite(o.adjust.saturation, 0, 2, "饱和度");
      finite(o.adjust.brightness, 0, 2, "亮度");
    }
    if (o.type === "image") {
      if (
        typeof o.asset?.src !== "string" ||
        !/^data:image\/(png|jpeg|webp);base64,/.test(o.asset.src) ||
        o.asset.src.length > 12000000
      )
        throw Error("图片须为内嵌 PNG/JPEG/WebP，最大 8 MB");
      finite(o.geometry?.width, 1, 8192, "图片宽度");
      finite(o.geometry?.height, 1, 8192, "图片高度");
    }
    if (o.material) {
      for (const key of ["clearcoat", "clearcoatRoughness"])
        if (o.material[key] !== undefined) finite(o.material[key], 0, 1, key);
      if (o.material.emissiveIntensity !== undefined)
        finite(o.material.emissiveIntensity, 0, 5, "自发光强度");
      if (
        o.material.emissive !== undefined &&
        !/^#[0-9a-f]{6}$/i.test(o.material.emissive)
      )
        throw Error("自发光颜色无效");
    }
    if (o.type === "camera") {
      cameras++;
      finite(o.projection?.fov, 5, 120, "相机 FOV");
      finite(o.projection.near, 0.001, 10, "near");
      finite(o.projection.far, o.projection.near + 0.01, 10000, "far");
    }
  }
  if (cameras !== 1) throw Error("必须且只能有一个相机");
  if (
    !p.scene ||
    p.scene.background !== null ||
    p.scene.environment !== "studio"
  )
    throw Error("scene 必须使用透明背景与 studio 环境");
  finite(p.scene.exposure, 0.1, 5, "曝光");
  validateBackdrop(p.scene.backdrop, p.duration);
  if (!Array.isArray(p.scene.lights) || p.scene.lights.length > 12)
    throw Error("光源数量不正确");
  for (let l of p.scene.lights) {
    if (!["ambient", "directional", "hemisphere"].includes(l.type))
      throw Error("不支持的光源");
    if (!/^#[0-9a-f]{6}$/i.test(l.color)) throw Error("光源颜色不正确");
    finite(l.intensity, 0, 20, "光源强度");
    if (l.type === "directional") {
      if (!Array.isArray(l.position) || l.position.length !== 3)
        throw Error("光源位置不正确");
      l.position.forEach((v) => finite(v, -1000, 1000, "光源位置"));
    }
    if (l.type === "hemisphere" && !/^#[0-9a-f]{6}$/i.test(l.groundColor))
      throw Error("地面光颜色不正确");
  }
  return p;
}
function fromData(data) {
  const a = Uint8Array.from(atob(data.split(",").at(-1)), (c) =>
    c.charCodeAt(0),
  );
  return opentype.parse(a.buffer);
}
export class Engine {
  constructor(canvas, options = {}) {
    this.interactive = options.interactive !== false;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: options.antialias ?? true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? true,
    });
    this.renderer.setPixelRatio(
      options.pixelRatio ?? Math.min(globalThis.devicePixelRatio || 1, 2),
    );
    this.renderer.setClearColor(0, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.localClippingEnabled = true;
    this.scene = new THREE.Scene();
    this.screenScene = new THREE.Scene();
    this.screenCamera = new THREE.OrthographicCamera(
      -960,
      960,
      540,
      -540,
      0.1,
      10000,
    );
    this.screenCamera.position.z = 5000;
    this.imageTextures = new Map();
    this.imageJobs = new Set();
    this.imageErrors = new Map();
    this.camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 200);
    this.nodes = new Map();
    this.font = opentype.parse(
      options.fontBuffer || globalThis.DEFAULT_FONT_BUFFER,
    );
    this.backdrop = new BroadcastBackground();
    this.backdrop.fullResolution = !!options.fullResolutionBackground;
    this.defaultFont = this.font;
    this.fontData = null;
    const texture = (key, url) => {
      if (options.bitmaps?.[key]) {
        const t = new THREE.Texture(options.bitmaps[key]);
        t.flipY = false;
        t.needsUpdate = true;
        return t;
      }
      return new THREE.TextureLoader().load(url);
    };
    this.texture = texture("earth", globalThis.EARTH);
    this.cloudTexture = texture("cloud", globalThis.CLOUD);
    this.cloudTexture.colorSpace = THREE.SRGBColorSpace;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.ribbonTextures = Object.fromEntries(
      Object.entries(
        options.bitmaps
          ? { red: null, green: null, blue: null }
          : globalThis.RIBBON_IMAGES,
      ).map(([key, url]) => {
        let tex = texture(key, url);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        return [key, tex];
      }),
    );
    const c =
      typeof document === "undefined"
        ? new OffscreenCanvas(1024, 512)
        : document.createElement("canvas");
    c.width = 1024;
    c.height = 512;
    let ctx = c.getContext("2d"),
      g = ctx.createLinearGradient(0, 0, 0, 512);
    [
      [0, "#b8c7dd"],
      [0.3, "#faf3d6"],
      [0.46, "#1a170e"],
      [0.55, "#2c210b"],
      [0.75, "#8a743b"],
      [1, "#e4d4a0"],
    ].forEach(([t, col]) => g.addColorStop(t, col));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 512);
    ctx.fillStyle = "#fff";
    ctx.fillRect(190, 20, 65, 230);
    ctx.fillRect(700, 80, 140, 50);
    let env = new THREE.CanvasTexture(c);
    env.mapping = THREE.EquirectangularReflectionMapping;
    let pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromEquirectangular(env).texture;
    pm.dispose();
    this.envSource = env;
    this.ray = new THREE.Raycaster();
    if (this.interactive) this.initHelpers();
    this.previewRotation = null;
    this.previewMotion = null;
    if (this.interactive) this.initGizmo(canvas);
  }
  setFont(data) {
    if (data === this.fontData) return;
    this.font = data ? fromData(data) : this.defaultFont;
    this.fontData = data;
  }
  checkText(content) {
    let missing = [
      ...new Set(
        [...content].filter(
          (c) => c !== "\n" && !this.font.charToGlyphIndex(c),
        ),
      ),
    ];
    if (missing.length)
      throw Error(
        "当前字体缺少字形：" +
          missing.join("") +
          "。请导入包含这些字符的 OTF / TTF 字体。",
      );
  }
  imageTexture(src) {
    if (this.imageTextures.has(src)) return this.imageTextures.get(src);
    const texture = new THREE.Texture();
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    this.imageTextures.set(src, texture);
    const job = fetch(src)
      .then((r) => r.blob())
      .then((blob) =>
        createImageBitmap(blob, {
          imageOrientation: "flipY",
          premultiplyAlpha: "none",
        }),
      )
      .then((bitmap) => {
        if (this.imageTextures.get(src) !== texture) {
          bitmap.close();
          return;
        }
        this.imageErrors.delete(src);
        texture.image = bitmap;
        texture.needsUpdate = true;
        this.onAssetsReady?.();
      })
      .catch((error) => {
        if (this.imageTextures.get(src) === texture) {
          this.imageErrors.set(src, error);
          this.onAssetError?.(error);
        }
      })
      .finally(() => this.imageJobs.delete(job));
    this.imageJobs.add(job);
    return texture;
  }
  async imagesReady() {
    await Promise.all([...this.imageJobs]);
    const active = new Set(
      [...this.nodes.values()].map((n) => n.userData.imageSrc),
    );
    for (const [src, error] of this.imageErrors)
      if (active.has(src)) throw Error("图片解码失败：" + error.message);
  }
  pruneImages() {
    const active = new Set(
      [...this.nodes.values()].map((n) => n.userData.imageSrc),
    );
    for (const [src, texture] of this.imageTextures)
      if (!active.has(src)) {
        texture.dispose();
        texture.image?.close?.();
        this.imageTextures.delete(src);
        this.imageErrors.delete(src);
      }
  }
  materials(o) {
    return ["color", "sideColor"].map((key) =>
      o.type === "text2d"
        ? new THREE.MeshBasicMaterial({
            color: o.material[key],
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
          })
        : new THREE.MeshPhysicalMaterial({
            color: o.material[key],
            metalness: o.material.metalness,
            roughness: o.material.roughness,
            clearcoat: o.material.clearcoat ?? 0,
            clearcoatRoughness: o.material.clearcoatRoughness ?? 0.1,
            emissive: o.material.emissive ?? "#000000",
            emissiveIntensity: o.material.emissiveIntensity ?? 0,
          }),
    );
  }
  buildText(o) {
    if (["text", "text2d"].includes(o.type) && o.text.sourceMode === "svg") {
      const group = new THREE.Group(),
        geo = svgGeometry(o.text, o.type === "text2d");
      group.add(
        new THREE.Mesh(
          geo,
          o.type === "text2d" ? this.materials(o)[0] : this.materials(o),
        ),
      );
      geo.computeBoundingBox();
      group.userData.width = geo.boundingBox.max.x - geo.boundingBox.min.x;
      return group;
    }
    this.checkText(o.text.content);
    let group = new THREE.Group(),
      x = 0,
      p = o.text,
      scale = p.size / this.font.unitsPerEm,
      mats = this.materials(o);
    for (let char of [...p.content]) {
      let glyph = this.font.charToGlyph(char),
        path = new THREE.ShapePath();
      for (let cmd of glyph.path.commands) {
        if (cmd.type === "M") path.moveTo(cmd.x * scale, cmd.y * scale);
        else if (cmd.type === "L") path.lineTo(cmd.x * scale, cmd.y * scale);
        else if (cmd.type === "C")
          path.bezierCurveTo(
            cmd.x1 * scale,
            cmd.y1 * scale,
            cmd.x2 * scale,
            cmd.y2 * scale,
            cmd.x * scale,
            cmd.y * scale,
          );
        else if (cmd.type === "Q")
          path.quadraticCurveTo(
            cmd.x1 * scale,
            cmd.y1 * scale,
            cmd.x * scale,
            cmd.y * scale,
          );
        else if (cmd.type === "Z") path.currentPath?.closePath();
      }
      let shapes = glyphShapes(path, p.curveSegments);
      if (shapes.length) {
        const geo =
          o.type === "text2d"
            ? new THREE.ShapeGeometry(shapes, p.curveSegments)
            : new THREE.ExtrudeGeometry(shapes, {
                depth: p.depth,
                bevelEnabled: p.bevelSize > 0 && p.bevelThickness > 0,
                bevelSize: p.bevelSize,
                bevelThickness: p.bevelThickness,
                bevelSegments: p.bevelSegments,
                curveSegments: p.curveSegments,
                steps: 1,
              });
        if (o.type !== "text2d") smoothExtrusion(geo);
        geo.translate(x, 0, -p.depth / 2);
        group.add(new THREE.Mesh(geo, o.type === "text2d" ? mats[0] : mats));
      }
      x += (glyph.advanceWidth || this.font.unitsPerEm) * scale + p.tracking;
    }
    let box = new THREE.Box3().setFromObject(group);
    if (!box.isEmpty()) {
      let center = box.getCenter(new THREE.Vector3());
      group.children.forEach((m) =>
        m.geometry.translate(-center.x, -center.y, 0),
      );
      group.userData.width = box.max.x - box.min.x;
    } else group.userData.width = 1;
    return group;
  }
  make(o) {
    let node = new THREE.Group();
    if (["text", "text2d"].includes(o.type))
      node = this.buildText(
        o.type === "text2d"
          ? {
              ...o,
              text: { ...o.text, depth: 0, bevelSize: 0, bevelThickness: 0 },
            }
          : o,
      );
    if (o.type === "image") {
      const material = new THREE.MeshBasicMaterial({
        map: this.imageTexture(o.asset.src),
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      material.userData.alwaysTransparent = true;
      node.add(
        new THREE.Mesh(
          new THREE.PlaneGeometry(o.geometry.width, o.geometry.height),
          material,
        ),
      );
    }

    if (o.type === "earth") {
      const p = earthMaterial(o);
      const surface =
        p.model === "physical"
          ? new THREE.MeshPhysicalMaterial({
              map: this.texture,
              color: p.color,
              metalness: p.metalness,
              roughness: p.roughness,
              clearcoat: p.clearcoat,
              clearcoatRoughness: p.clearcoatRoughness,
              emissive: p.emissive,
              emissiveIntensity: p.emissiveIntensity,
            })
          : new THREE.MeshPhongMaterial({
              map: this.texture,
              color: p.color,
              specular: p.specular,
              shininess: p.shininess,
              emissive: p.emissive,
              emissiveIntensity: p.emissiveIntensity,
            });
      surface.onBeforeCompile = (shader) => {
        shader.uniforms.earthRimStrength = {
          value: p.glowEnabled ? p.rimIntensity : 0,
        };
        shader.fragmentShader =
          "uniform float earthRimStrength;\n" + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <map_fragment>",
            "#include <map_fragment>\nfloat oceanMask=smoothstep(0.,.03,diffuseColor.b-diffuseColor.r)*smoothstep(0.,.02,diffuseColor.b-diffuseColor.g);diffuseColor.rgb*=mix(1.,.42,oceanMask);",
          )
          .replace(
            "#include <opaque_fragment>",
            `float viewRim=pow(1.-abs(dot(normal,normalize(vViewPosition))),4.);float softHighlight=pow(max(0.,dot(normal,normalize(vec3(.45,.3,.84)))),24.);outgoingLight+=earthRimStrength*viewRim*vec3(.09,.13,.14)+softHighlight*vec3(.035,.08,.10);
#include <opaque_fragment>`,
          );
      };
      surface.customProgramCacheKey = () => "earth-reference-rim-v3";
      node.add(new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), surface));
      const cloudMaterial = new THREE.MeshBasicMaterial({
        map: this.cloudTexture,
        color: 0xe2e8ed,
        transparent: true,
        depthWrite: false,
      });
      cloudMaterial.userData.alwaysTransparent = true;
      cloudMaterial.userData.opacityScale = p.cloudOpacity;
      node.add(
        new THREE.Mesh(new THREE.SphereGeometry(1.004, 64, 48), cloudMaterial),
      );
      for (const [radius, strength] of p.glowEnabled
        ? [
            [1 + p.glowWidth * (12 / 35), 0.48 * p.glowIntensity],
            [1 + p.glowWidth, 0.2 * p.glowIntensity],
          ]
        : []) {
        const at = new THREE.Mesh(
          new THREE.SphereGeometry(radius, 64, 48),
          new THREE.ShaderMaterial({
            transparent: true,
            side: THREE.BackSide,
            depthWrite: false,
            uniforms: {
              opacity: { value: 1 },
              strength: { value: strength },
              falloff: { value: p.glowFalloff },
              haloRadius: { value: radius },
              glowColor: {
                value: o.earthMaterial?.glowColor
                  ? new THREE.Color(p.glowColor)
                  : new THREE.Color().setRGB(0.65, 0.8, 1),
              },
            },
            vertexShader:
              "varying vec3 n;varying vec3 v;void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=normalize(-p.xyz);gl_Position=projectionMatrix*p;}",
            fragmentShader:
              "uniform float opacity;uniform float strength;uniform float falloff;uniform float haloRadius;uniform vec3 glowColor;varying vec3 n;varying vec3 v;void main(){float mu=abs(dot(normalize(n),normalize(v)));float edge=sqrt(max(0.,1.-mu*mu));float inner=1./haloRadius;float a=.35*pow(clamp((1.-edge)/(1.-inner),0.,1.),falloff)*smoothstep(inner-.025,inner+.005,edge);gl_FragColor=vec4(glowColor,a*strength*opacity);}",
          }),
        );
        node.add(at);
      }
    }
    if (o.type === "ribbon") {
      let p = o.geometry,
        m = new THREE.MeshBasicMaterial({
          map: this.ribbonTextures[o.image],
          color: 0xffffff,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
          alphaTest: 0.001,
        });
      m.userData.imageRibbon = true;
      node.add(new THREE.Mesh(new THREE.PlaneGeometry(p.width, p.height), m));
    }
    if (o.type === "logo") {
      let poly = (pts) => {
        let s = new THREE.Shape();
        s.moveTo(...pts[0]);
        pts.slice(1).forEach((p) => s.lineTo(...p));
        s.closePath();
        return s;
      };
      let c = (x) => {
        let s = new THREE.Shape(),
          r = 0.57,
          ri = 0.37;
        s.absarc(x, 0, r, 0.24 * Math.PI, 1.76 * Math.PI, false);
        s.lineTo(
          x + ri * Math.cos(1.76 * Math.PI),
          ri * Math.sin(1.76 * Math.PI),
        );
        s.absarc(x, 0, ri, 1.76 * Math.PI, 0.24 * Math.PI, true);
        s.closePath();
        return s;
      };
      let shapes = [
        c(-1.48),
        c(-0.43),
        poly([
          [0.08, 0.57],
          [1.23, 0.57],
          [1.23, 0.36],
          [0.77, 0.36],
          [0.77, -0.57],
          [0.55, -0.57],
          [0.55, 0.36],
          [0.08, 0.36],
        ]),
        poly([
          [1.06, 0.57],
          [1.3, 0.57],
          [1.67, -0.28],
          [2.04, 0.57],
          [2.28, 0.57],
          [1.78, -0.57],
          [1.56, -0.57],
        ]),
      ];
      let mats = this.materials(o);
      for (let s of shapes) {
        let geo = new THREE.ExtrudeGeometry(s, {
          depth: o.geometry.depth,
          bevelEnabled: o.geometry.bevelSize > 0,
          bevelSize: o.geometry.bevelSize,
          bevelThickness: o.geometry.bevelSize,
          bevelSegments: 3,
          curveSegments: 24,
        });
        smoothExtrusion(geo);
        geo.translate(-0.15, 0, -o.geometry.depth / 2);
        node.add(new THREE.Mesh(geo, mats));
      }
    }
    if (isScreen(o))
      node.traverse((n) => {
        for (const m of n.material
          ? Array.isArray(n.material)
            ? n.material
            : [n.material]
          : []) {
          m.transparent = true;
          m.userData.alwaysTransparent = true;
        }
      });
    const adjusted = new Set();
    node.traverse((n) => {
      for (const m of n.material
        ? Array.isArray(n.material)
          ? n.material
          : [n.material]
        : [])
        if (!adjusted.has(m)) {
          applyAdjustment(m, o.adjust);
          adjusted.add(m);
        }
    });
    node.userData.id = o.id;
    node.traverse((n) => {
      n.userData.id = o.id;
      n.layers.set(["text", "logo", "ribbon"].includes(o.type) ? 1 : 0);
    });
    node.userData.clip = new THREE.Plane();
    let bounds = new THREE.Box3().setFromObject(node);
    // Keep the original earth pivot envelope independent of editable halo width.
    if (o.type === "earth") {
      const r = Math.fround(1.035);
      bounds.set(new THREE.Vector3(-r, -r, -r), new THREE.Vector3(r, r, r));
    }
    if (bounds.isEmpty())
      bounds.set(
        new THREE.Vector3(-0.5, -0.5, -0.5),
        new THREE.Vector3(0.5, 0.5, 0.5),
      );
    let root = new THREE.Group(),
      shift = new THREE.Group(),
      spin = new THREE.Group();
    root.add(shift);
    shift.add(spin);
    spin.add(node);
    let normalRoot = new THREE.Group();
    normalRoot.matrixAutoUpdate = false;
    normalRoot.add(root);
    normalRoot.userData = {
      id: o.id,
      model: node,
      shift,
      spin,
      bounds,
      rigRoot: root,
      clip: node.userData.clip,
    };
    return normalRoot;
  }
  disposeNode(n) {
    let mats = new Set();
    n.traverse((c) => {
      c.geometry?.dispose();
      if (c.material)
        (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) =>
          mats.add(m),
        );
    });
    mats.forEach((m) => m.dispose());
    this.scene.remove(n);
    this.screenScene.remove(n);
  }
  rebuild(o) {
    this.helperCache = "";
    let newNode = this.make(o);
    let old = this.nodes.get(o.id);
    if (old) this.disposeNode(old);
    if (o.type === "image") newNode.userData.imageSrc = o.asset.src;
    this.nodes.set(o.id, newNode);
    (isScreen(o) ? this.screenScene : this.scene).add(newNode);
    if (!this.loadingImages) this.pruneImages();
  }
  load(p) {
    migrate(p);
    this.setFont(p.fontData || null);
    p.objects
      .filter((o) => o.type === "text" && o.text.sourceMode !== "svg")
      .forEach((o) => this.checkText(o.text.content));
    this.loadingImages = true;
    this.nodes.forEach((n) => this.disposeNode(n));
    this.nodes.clear();
    this.scene.children
      .filter((n) => n.isLight)
      .forEach((n) => this.scene.remove(n));
    for (let l of p.scene.lights) {
      let n =
        l.type === "ambient"
          ? new THREE.AmbientLight(l.color, l.intensity)
          : l.type === "hemisphere"
            ? new THREE.HemisphereLight(l.color, l.groundColor, l.intensity)
            : new THREE.DirectionalLight(l.color, l.intensity);
      if (l.position) n.position.fromArray(l.position);
      n.layers.enable(1);
      this.scene.add(n);
    }
    for (let o of p.objects) if (o.type !== "camera") this.rebuild(o);
    this.loadingImages = false;
    this.pruneImages();
    this.renderer.toneMappingExposure = p.scene.exposure;
    this.prepareRotations(p);
    this.previewRotation = null;
    this.previewMotion = null;
  }
  pivot(o) {
    let box = this.nodes.get(o.id)?.userData.bounds;
    let v = new THREE.Vector3();
    if (box && o.pivot.preset !== "custom") {
      box.getCenter(v);
      let map = {
        left: ["x", "min"],
        right: ["x", "max"],
        bottom: ["y", "min"],
        top: ["y", "max"],
        front: ["z", "max"],
        back: ["z", "min"],
      };
      let a = map[o.pivot.preset];
      if (a) v[a[0]] = box[a[1]][a[0]];
    }
    return v.add(new THREE.Vector3().fromArray(o.pivot.offset));
  }
  motionValues(o, t) {
    const v = values(o, t);
    if (this.previewMotion?.id === o.id)
      Object.assign(v, this.previewMotion.values);
    return v;
  }
  legacyPose(o, t) {
    let v = this.motionValues(o, t);
    if (o.rotationReference)
      for (let k of ["rx", "ry", "rz", "normalSpin"])
        v[k] = sample(
          o.rotationReference.tracks[k],
          t,
          o.rotationReference.base[k],
        );
    let p = this.pivot(o),
      c = new THREE.Vector3().fromArray(o.orbit.center);
    let q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(v.rx * rad, v.ry * rad, v.rz * rad),
      ),
      gq = o.base.groupRotation
        ? this.rotation(o, "groupRotation", t)
        : new THREE.Quaternion().setFromEuler(
            new THREE.Euler(v.grx * rad, v.gry * rad, v.grz * rad),
          );
    let G = new THREE.Matrix4()
      .compose(
        c.clone().add(new THREE.Vector3(v.gx, v.gy, v.gz)),
        gq,
        new THREE.Vector3(v.gsx, v.gsy, v.gsz),
      )
      .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    let L = new THREE.Matrix4()
      .compose(
        new THREE.Vector3(v.x, v.y, v.z).add(p),
        q,
        new THREE.Vector3(v.sx, v.sy, v.sz),
      )
      .multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
    const baseMatrix = G.clone().multiply(L),
      pivotWorld = new THREE.Vector3(v.x, v.y, v.z).add(p).applyMatrix4(G);
    // Actual front-face normal in world space, including nonuniform parent scales.
    const normal = new THREE.Vector3(0, 0, 1).applyNormalMatrix(
      new THREE.Matrix3().getNormalMatrix(baseMatrix),
    );
    const normalQ = new THREE.Quaternion().setFromAxisAngle(
      normal,
      v.normalSpin * rad,
    );
    const normalMatrix = new THREE.Matrix4();
    if (v.normalSpin !== 0)
      normalMatrix
        .makeTranslation(pivotWorld.x, pivotWorld.y, pivotWorld.z)
        .multiply(new THREE.Matrix4().makeRotationFromQuaternion(normalQ))
        .multiply(
          new THREE.Matrix4().makeTranslation(
            -pivotWorld.x,
            -pivotWorld.y,
            -pivotWorld.z,
          ),
        );
    return {
      v,
      p,
      c,
      G,
      L,
      baseMatrix,
      normal,
      normalQ,
      normalMatrix,
      matrix: normalMatrix.clone().multiply(baseMatrix),
      pivotWorld,
      orbitWorld: c.clone().add(new THREE.Vector3(v.gx, v.gy, v.gz)),
    };
  }
  rotation(o, ch, t) {
    if (
      this.previewRotation?.id === o.id &&
      this.previewRotation.channel === ch
    )
      return this.previewRotation.value.clone();
    return sampleQuaternion(o.tracks[ch], t, o.base[ch]);
  }
  pose(o, t) {
    if (isScreen(o)) return this.legacyPose(o, t);
    const ref = this.legacyPose(o, t);
    if (!o.base.rotation)
      return {
        ...ref,
        orientation: frameQuaternion(ref.matrix),
        parentQ: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(ref.v.grx * rad, ref.v.gry * rad, ref.v.grz * rad),
        ),
      };
    const parentQ = this.rotation(o, "groupRotation", t),
      localQ = this.rotation(o, "rotation", t),
      orientation = parentQ.clone().multiply(localQ).normalize(),
      referenceQ = frameQuaternion(ref.matrix),
      correction = orientation.clone().multiply(referenceQ.invert()),
      P = ref.pivotWorld;
    const rigid = new THREE.Matrix4()
      .makeTranslation(P.x, P.y, P.z)
      .multiply(new THREE.Matrix4().makeRotationFromQuaternion(correction))
      .multiply(new THREE.Matrix4().makeTranslation(-P.x, -P.y, -P.z));
    const matrix = rigid.multiply(ref.matrix);
    return {
      ...ref,
      matrix,
      parentQ,
      localQ,
      orientation,
      normal: new THREE.Vector3(0, 0, 1).applyQuaternion(orientation),
    };
  }
  prepareRotations(project) {
    for (let o of project.objects) {
      if (o.type === "camera" || isScreen(o)) continue;
      if (o.links) {
        delete o.links.rotation;
        delete o.links.groupRotation;
      }
      let oldGroup = structuredClone({ base: o.base, tracks: o.tracks });
      if (!o.rotationReference)
        o.rotationReference = {
          base: Object.fromEntries(
            ["rx", "ry", "rz", "normalSpin"].map((k) => [k, o.base[k]]),
          ),
          tracks: Object.fromEntries(
            ["rx", "ry", "rz", "normalSpin"].map((k) => [
              k,
              structuredClone(o.tracks[k] || []),
            ]),
          ),
        };
      if (!o.base.groupRotation) {
        let fn = (t) =>
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              ...["grx", "gry", "grz"].map(
                (k) => sample(oldGroup.tracks[k], t, oldGroup.base[k]) * rad,
              ),
            ),
          );
        const result = this.bakeRotation(
          project,
          o,
          fn,
          ["grx", "gry", "grz"],
          oldGroup,
        );
        o.base.groupRotation = result.base;
        if (result.keys.length) o.tracks.groupRotation = result.keys;
      }
      if (!o.base.rotation) {
        let fn = (t) => {
          const ref = this.legacyPose(o, t);
          return this.rotation(o, "groupRotation", t)
            .invert()
            .multiply(frameQuaternion(ref.matrix))
            .normalize();
        };
        const source = {
          base: { ...o.base, ...o.rotationReference.base },
          tracks: { ...o.tracks, ...o.rotationReference.tracks },
        };
        const result = this.bakeRotation(
          project,
          o,
          fn,
          [
            "rx",
            "ry",
            "rz",
            "normalSpin",
            "sx",
            "sy",
            "sz",
            "gsx",
            "gsy",
            "gsz",
          ],
          source,
        );
        o.base.rotation = result.base;
        if (result.keys.length) o.tracks.rotation = result.keys;
      }
      for (let k of ["rx", "ry", "rz", "normalSpin", "grx", "gry", "grz"])
        delete o.tracks[k];
    }
  }
  bakeRotation(project, o, fn, channels, source) {
    let times = [0, project.duration];
    for (let c of channels)
      times.push(...(source.tracks[c] || []).map((k) => k.time));
    times = [...new Set(times)].sort((a, b) => a - b);
    let fine = [];
    for (let i = 0; i < times.length - 1; i++) {
      let a = times[i],
        b = times[i + 1],
        delta = Math.max(
          0,
          ...channels
            .filter((c) => !c.includes("s"))
            .map((c) =>
              Math.abs(
                sample(source.tracks[c], b, source.base[c]) -
                  sample(source.tracks[c], a, source.base[c]),
              ),
            ),
        );
      let pieces = Math.max(1, Math.ceil(delta / 60));
      if (pieces > 2048) throw Error("旧旋转圈数过多，请缩短片段后导入");
      for (let j = 0; j < pieces; j++) fine.push(a + ((b - a) * j) / pieces);
    }
    fine.push(project.duration);
    let result = [];
    const append = (t, q) => {
      if (result.at(-1)?.time === t) return;
      const previous = result.at(-1);
      if (
        previous &&
        new THREE.Quaternion().fromArray(previous.value).dot(q) < 0
      )
        q = new THREE.Quaternion(-q.x, -q.y, -q.z, -q.w);
      result.push({
        time: t,
        value: q.toArray().map((v) => (v === 0 ? 0 : v)),
        easing: "linear",
      });
    };
    const split = (a, b, qa, qb, depth = 0) => {
      let bad = [0.25, 0.5, 0.75].some(
        (u) =>
          qa
            .clone()
            .slerp(qb, u)
            .angleTo(fn(a + (b - a) * u)) > 0.0005,
      );
      if (bad && depth < 12) {
        let t = (a + b) / 2,
          q = fn(t);
        split(a, t, qa, q, depth + 1);
        split(t, b, q, qb, depth + 1);
      } else {
        append(a, qa);
        append(b, qb);
      }
      if (result.length > 8192)
        throw Error("旋转转换超出 8192 帧，请先拆分项目");
    };
    for (let i = 0; i < fine.length - 1; i++)
      split(fine[i], fine[i + 1], fn(fine[i]), fn(fine[i + 1]));
    let base = fn(0)
      .toArray()
      .map((v) => (v === 0 ? 0 : v));
    if (
      result.every(
        (k) =>
          new THREE.Quaternion()
            .fromArray(k.value)
            .angleTo(new THREE.Quaternion().fromArray(base)) < 1e-7,
      )
    )
      result = [];
    return { base, keys: result };
  }
  initGizmo(canvas) {
    this.gizmoScene = new THREE.Scene();
    this.rotationProxy = new THREE.Object3D();
    this.gizmoScene.add(this.rotationProxy);
    this.rotateControls = new TransformControls(this.camera, canvas);
    this.rotateControls.setMode("rotate");
    this.rotateControls.setSpace("local");
    this.rotateControls.setSize(1.25);
    for (let group of [
      this.rotateControls._gizmo.gizmo.rotate,
      this.rotateControls._gizmo.picker.rotate,
    ])
      for (let child of [...group.children])
        if (["E", "XYZE"].includes(child.name)) group.remove(child);
    this.rotateControls._gizmo.gizmo.rotate.traverse((o) => {
      if (o.material && ["X", "Y", "Z"].includes(o.name))
        o.material.color.set({ X: 0xff6873, Y: 0x76d58e, Z: 0x6eafff }[o.name]);
    });
    this.gizmoScene.add(this.rotateControls);
    this.gizmoState = null;
  }
  syncGizmo(project, t, opt) {
    const ctrl = this.rotateControls;
    if (ctrl.dragging) return;
    let o = project.objects.find((o) => o.id === opt?.id);
    const can =
      !!opt?.enabled &&
      o &&
      o.type !== "camera" &&
      !isScreen(o) &&
      o.enabled &&
      t >= o.in &&
      t <= o.out;
    ctrl.enabled = can;
    if (!can) {
      ctrl.detach();
      this.gizmoState = null;
      return;
    }
    let pose = this.pose(o, t),
      parent = opt.target === "parent";
    this.rotationProxy.position.copy(
      parent ? pose.orbitWorld : pose.pivotWorld,
    );
    this.rotationProxy.quaternion.copy(
      parent ? pose.parentQ : pose.orientation,
    );
    const mode = opt.mode || "rotate",
      v = pose.v;
    ctrl.setMode(mode);
    this.rotationProxy.scale.set(
      ...(mode === "scale"
        ? parent
          ? [v.gsx, v.gsy, v.gsz]
          : [v.sx, v.sy, v.sz]
        : [1, 1, 1]),
    );
    ctrl.setSpace(mode === "scale" ? "local" : opt.space || "local");
    ctrl.setRotationSnap(opt.snap ? (opt.snap * Math.PI) / 180 : null);
    if (ctrl.object !== this.rotationProxy) ctrl.attach(this.rotationProxy);
    this.gizmoState = {
      id: o.id,
      mode,
      target: opt.target,
      channel: parent ? "groupRotation" : "rotation",
      pose,
    };
    this.gizmoScene.updateMatrixWorld(true);
  }
  gizmoValue(o, ch, t, proxy = this.rotationProxy) {
    let q = proxy.quaternion.clone();
    if (ch === "rotation")
      q.premultiply(this.rotation(o, "groupRotation", t).invert());
    return q.normalize();
  }
  cancelGizmo() {
    this.rotateControls.reset();
    this.rotateControls.dragging = false;
    this.rotateControls.axis = null;
    this.previewRotation = null;
    this.previewMotion = null;
  }
  compensate(before, after, t) {
    let a = this.pose(before, t),
      b = this.pose(after, t);
    let d = new THREE.Vector3()
      .setFromMatrixPosition(a.matrix)
      .sub(new THREE.Vector3().setFromMatrixPosition(b.matrix));
    let linear = new THREE.Matrix3().setFromMatrix4(b.G).invert();
    return d.applyMatrix3(linear);
  }
  render(p, t, solo = null, guides = null, options = {}) {
    for (let o of p.objects) {
      let v = this.motionValues(
        o,
        o.type === "camera" ? clamp(t, o.in, o.out) : t,
      );
      if (o.type === "camera") {
        this.camera.position.set(v.x, v.y, v.z);
        this.camera.rotation.set(v.rx * rad, v.ry * rad, v.rz * rad);
        Object.assign(this.camera, o.projection);
        this.camera.aspect = p.aspect[0] / p.aspect[1];
        this.camera.updateProjectionMatrix();
        continue;
      }
      let n = this.nodes.get(o.id);
      if (!n) continue;
      let pose = this.pose(o, t);
      n.visible =
        o.enabled && t >= o.in && t <= o.out && (!solo || solo === o.id);
      n.matrix.copy(pose.matrix);
      if (isScreen(o))
        n.traverse((c) => {
          c.renderOrder = 100 + p.objects.indexOf(o);
        });
      let model = n.userData.model;
      n.updateMatrixWorld(true);
      let reveal = v.reveal;
      n.userData.clip
        .set(
          new THREE.Vector3(-1, 0, 0),
          (reveal - 0.5) * (model.userData.width || 14),
        )
        .applyMatrix4(model.matrixWorld);
      n.traverse((c) => {
        if (c.material)
          for (let m of Array.isArray(c.material) ? c.material : [c.material]) {
            m.opacity = v.opacity * (m.userData.opacityScale ?? 1);
            if (m.uniforms?.opacity) m.uniforms.opacity.value = v.opacity;
            let transparent =
              m.userData.alwaysTransparent ||
              m.userData.imageRibbon ||
              m.isShaderMaterial ||
              v.opacity < 1;
            if (m.transparent !== transparent) {
              m.transparent = transparent;
              m.needsUpdate = true;
            }
            m.clippingPlanes =
              o.type === "text" && reveal < 1 ? [n.userData.clip] : null;
          }
      });
    }
    this.camera.layers.set(0);
    const backgroundDrawn =
      !options.transparent && this.backdrop.render(this.renderer, p, t, sample);
    this.renderer.autoClear = !backgroundDrawn;
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.camera.layers.set(1);
    this.renderer.autoClear = false;
    this.renderer.render(this.scene, this.camera);
    this.camera.layers.set(0);
    const screenWidth = (1080 * p.aspect[0]) / p.aspect[1];
    this.screenCamera.left = -screenWidth / 2;
    this.screenCamera.right = screenWidth / 2;
    this.screenCamera.updateProjectionMatrix();
    this.renderer.clearDepth();
    this.renderer.render(this.screenScene, this.screenCamera);
    if (guides) {
      this.renderHelpers(p, t, guides);
      this.syncGizmo(p, t, guides.gizmo);
      if (this.rotateControls.visible) {
        this.renderer.clearDepth();
        this.renderer.render(this.gizmoScene, this.camera);
      }
    }
  }
  initHelpers() {
    this.helperScene = new THREE.Scene();
    this.axes = new THREE.AxesHelper(1.7);
    this.orbitAxes = new THREE.AxesHelper(0.9);
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd37c, depthTest: false }),
    );
    this.orbitMarker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.14),
      new THREE.MeshBasicMaterial({
        color: 0x70cfff,
        wireframe: true,
        depthTest: false,
      }),
    );
    this.path = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0x73c7e7,
        transparent: true,
        opacity: 0.7,
        depthTest: false,
      }),
    );
    this.link = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({
        color: 0x907d58,
        dashSize: 0.13,
        gapSize: 0.1,
        transparent: true,
        opacity: 0.8,
        depthTest: false,
      }),
    );
    this.helperScene.add(
      this.axes,
      this.orbitAxes,
      this.marker,
      this.orbitMarker,
      this.path,
      this.link,
    );
    this.helperCache = "";
  }
  renderHelpers(project, t, opt) {
    let o = project.objects.find((o) => o.id === opt.id);
    if (!o || o.type === "camera" || isScreen(o)) return;
    let n = this.nodes.get(o.id),
      pose = this.pose(o, t);
    this.axes.visible = this.marker.visible = !!opt.pivot;
    this.orbitAxes.visible =
      this.orbitMarker.visible =
      this.link.visible =
        !!opt.pivot;
    this.path.visible = !!opt.path;
    this.axes.position.copy(pose.pivotWorld);
    let tangent = new THREE.Vector3(1, 0, 0).transformDirection(pose.matrix),
      bitangent = new THREE.Vector3()
        .crossVectors(pose.normal, tangent)
        .normalize();
    this.axes.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(tangent, bitangent, pose.normal),
    );
    this.marker.position.copy(pose.pivotWorld);
    this.orbitMarker.position.copy(pose.orbitWorld);
    this.orbitAxes.position.copy(pose.orbitWorld);
    this.orbitAxes.quaternion.copy(pose.parentQ);
    if (opt.pivot) {
      this.link.geometry.dispose();
      this.link.geometry = new THREE.BufferGeometry().setFromPoints([
        pose.orbitWorld,
        pose.pivotWorld,
      ]);
      this.link.computeLineDistances();
    }
    let signature = JSON.stringify(o);
    if (opt.path && signature !== this.helperCache) {
      let pts = [];
      for (let i = 0; i <= 240; i++)
        pts.push(
          new THREE.Vector3().applyMatrix4(
            this.pose(o, o.in + ((o.out - o.in) * i) / 240).matrix,
          ),
        );
      this.path.geometry.dispose();
      this.path.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      this.helperCache = signature;
    }
    this.renderer.clearDepth();
    this.renderer.render(this.helperScene, this.camera);
  }
  resize() {
    let canvas = this.renderer.domElement,
      r = canvas.getBoundingClientRect();
    this.renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
  }
  pick(x, y) {
    let r = this.renderer.domElement.getBoundingClientRect();
    this.ray.layers.enableAll();
    this.ray.setFromCamera(
      new THREE.Vector2(
        ((x - r.left) / r.width) * 2 - 1,
        1 - ((y - r.top) / r.height) * 2,
      ),
      this.screenCamera,
    );
    const screenHit = this.ray
      .intersectObjects(this.screenScene.children, true)
      .filter((h) => this.nodes.get(h.object.userData.id)?.visible)
      .sort((a, b) => b.object.renderOrder - a.object.renderOrder)[0];
    if (screenHit) return screenHit.object.userData.id;
    this.ray.setFromCamera(
      new THREE.Vector2(
        ((x - r.left) / r.width) * 2 - 1,
        (-(y - r.top) / r.height) * 2 + 1,
      ),
      this.camera,
    );
    return this.ray
      .intersectObjects(this.scene.children, true)
      .filter((h) => this.nodes.get(h.object.userData.id)?.visible)
      .sort(
        (a, b) =>
          (b.object.layers.mask & 2) - (a.object.layers.mask & 2) ||
          a.distance - b.distance,
      )[0]?.object.userData.id;
  }
}
