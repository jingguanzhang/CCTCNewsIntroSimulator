import * as THREE from "./vendor/three/three.module.js";
export const isScreen = (o) => ["image", "text2d"].includes(o?.type);
export function applyAdjustment(material, settings = {}) {
  const h = settings.hue ?? 0,
    s = settings.saturation ?? 1,
    b = settings.brightness ?? 1;
  if (h === 0 && s === 1 && b === 1) return;
  const brightnessOnly = h === 0 && s === 1;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    shader.uniforms.elementAdjust = { value: new THREE.Vector3(h / 360, s, b) };
    shader.fragmentShader =
      `uniform vec3 elementAdjust;\n` +
      (brightnessOnly
        ? `vec3 adjustElement(vec3 c){return max(c,vec3(0.))*elementAdjust.z;}\n`
        : `
vec3 adjRgbToHsv(vec3 c){vec4 K=vec4(0.,-1./3.,2./3.,-1.);vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));float d=q.x-min(q.w,q.y);return vec3(abs(q.z+(q.w-q.y)/(6.*d+1.e-10)),d/(q.x+1.e-10),q.x);}
vec3 adjHsvToRgb(vec3 c){vec3 p=abs(fract(c.xxx+vec3(0.,2./3.,1./3.))*6.-3.);return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y);}
vec3 adjustElement(vec3 c){vec3 hsv=adjRgbToHsv(max(c,vec3(0.)));hsv.x=fract(hsv.x+elementAdjust.x);hsv.y=clamp(hsv.y*elementAdjust.y,0.,1.);return adjHsvToRgb(hsv)*elementAdjust.z;}
`) +
      shader.fragmentShader;
    if (shader.fragmentShader.includes("#include <colorspace_fragment>"))
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <colorspace_fragment>",
        "gl_FragColor.rgb=adjustElement(gl_FragColor.rgb);\n#include <colorspace_fragment>",
      );
    else
      shader.fragmentShader = shader.fragmentShader.replace(
        /}\s*$/,
        "gl_FragColor.rgb=adjustElement(gl_FragColor.rgb);\n}",
      );
  };
  const prior = material.customProgramCacheKey.bind(material);
  const key = prior();
  material.customProgramCacheKey = () =>
    key + "-element-adjust-v2-" + (brightnessOnly ? "rgb" : "hsv");
}
