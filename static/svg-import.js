import { SVGLoader } from "./vendor/three/addons/loaders/SVGLoader.js";
import { sanitizeSvgXml } from "./svg-doctype.js";

// SVG is parsed only during upload. The project stores plain contours, so the
// render worker never needs DOMParser and never executes or embeds SVG markup.
export async function readSvgFile(file) {
  if (file.size > 1024 * 1024) throw Error("SVG 文件上限为 1 MB");
  const text = sanitizeSvgXml(await file.text());
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  if (
    doc.querySelector("parsererror") ||
    doc.documentElement.localName !== "svg"
  )
    throw Error("SVG 文件无效");
  if (doc.querySelector("text,tspan"))
    throw Error("请先在设计软件中将 SVG 文字转为路径，再上传");
  if (
    doc.querySelector(
      "script,foreignObject,image,use,mask,clipPath,filter,pattern,linearGradient,radialGradient,animate,animateTransform,set",
    )
  )
    throw Error("仅支持填充路径和基本形状；请先展开引用、裁切、描边和特效");
  if (
    [...doc.querySelectorAll("style")].some((n) =>
      /url\s*\(|@import/i.test(n.textContent),
    )
  )
    throw Error("SVG 不允许外部样式或资源引用");
  const nodes = [...doc.querySelectorAll("*")];
  if (
    nodes.length > 2000 ||
    [...doc.querySelectorAll("path")].reduce(
      (n, p) => n + (p.getAttribute("d") || "").length,
      0,
    ) > 100000
  )
    throw Error("SVG 路径过于复杂，请简化后上传");
  for (const node of nodes)
    for (const a of node.attributes)
      if (
        /^on/i.test(a.name) ||
        /href$/i.test(a.name) ||
        /url\s*\(/i.test(a.value)
      )
        throw Error("SVG 不允许事件、外部资源或引用");
  const parsed = new SVGLoader().parse(text),
    contours = [];
  let count = 0,
    minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const points = (path) =>
    path.getPoints(16).map((p) => {
      if (++count > 20000 || !Number.isFinite(p.x) || !Number.isFinite(p.y))
        throw Error("SVG 轮廓过于复杂或坐标无效");
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
      return [p.x, p.y];
    });
  for (const path of parsed.paths) {
    const style = path.userData?.style || {};
    if (
      style.fill === "none" ||
      Number(style.fillOpacity) === 0 ||
      Number(style.opacity) === 0
    )
      continue;
    for (const shape of SVGLoader.createShapes(path)) {
      contours.push({ outer: points(shape), holes: shape.holes.map(points) });
      if (contours.length > 128) throw Error("SVG 最多支持 128 个填充轮廓");
    }
  }
  const height = maxY - minY;
  if (!contours.length || !(height > 0) || !(maxX > minX))
    throw Error("SVG 没有可用的填充轮廓；描边请先转为路径");
  if ((maxX - minX) / height > 100) throw Error("SVG 宽高比过大");
  for (const shape of contours)
    for (const ring of [shape.outer, ...shape.holes])
      for (const p of ring) {
        p[0] = (p[0] - (minX + maxX) / 2) / height;
        p[1] = ((minY + maxY) / 2 - p[1]) / height;
      }
  return { name: file.name, contours };
}
