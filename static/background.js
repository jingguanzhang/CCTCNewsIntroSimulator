import * as THREE from "./vendor/three/three.module.js";
// Independent screen-space backdrop; does not change any foreground transform or camera.
export const BACKDROP_DEFAULT = {
  enabled: true,
  style: "blue-rays",
  colors: { dark: "#00151e", blue: "#006692", light: "#72d9ef" },
  base: {
    intensity: 1,
    rotation: 0,
    travel: 0,
    centerX: 0.51,
    centerY: 0.52,
    particles: 0.65,
  },
  tracks: {
    intensity: [
      { time: 0, value: 0.9, easing: "linear" },
      { time: 5, value: 1, easing: "smooth" },
      { time: 16.916666666666668, value: 1, easing: "linear" },
      { time: 18.916666666666668, value: 1, easing: "linear" },
    ],
    rotation: [
      { time: 0, value: -12, easing: "linear" },
      { time: 16.916666666666668, value: 32, easing: "linear" },
      { time: 18.916666666666668, value: 37.20197044334975, easing: "linear" },
    ],
    travel: [
      { time: 0, value: 0, easing: "linear" },
      { time: 16.916666666666668, value: 19, easing: "linear" },
      { time: 18.916666666666668, value: 21.24630541871921, easing: "linear" },
    ],
  },
};
export class BroadcastBackground {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.material = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        aspect: { value: 16 / 9 },
        intensity: { value: 1 },
        rotation: { value: 0 },
        travel: { value: 0 },
        center: { value: new THREE.Vector2(0.51, 0.52) },
        particles: { value: 0.65 },
        dark: { value: new THREE.Color() },
        blue: { value: new THREE.Color() },
        light: { value: new THREE.Color() },
      },
      vertexShader: `varying vec2 uv0;void main(){uv0=uv;gl_Position=vec4(position.xy,0.,1.);}`,
      fragmentShader: `precision highp float;
varying vec2 uv0;uniform float aspect,intensity,rotation,travel,particles;uniform vec2 center;uniform vec3 dark,blue,light;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
float fog(vec2 p){float n=0.,a=.5;for(int i=0;i<4;i++){n+=a*noise(p);p=p*2.03+vec2(12.1,7.4);a*=.5;}return n;}
void main(){vec2 p=uv0-center;p.x*=aspect;float r=length(p),ang=atan(p.y,p.x)+rotation;float n=fog(vec2(ang*2.2,r*4.-travel*.18));float fan=0.,fine=0.;
 for(int i=0;i<16;i++){float f=float(i),a=f*6.2831853/16.+sin(f*4.7)*.18+sin(travel*.12+f)*.10;float d=mod(ang-a+3.14159265,6.2831853)-3.14159265;float w=.04+.095*hash(vec2(f,4.));float beam=exp(-d*d/(w*w));float pulse=.20+.80*pow(.5+.5*sin(r*5.-travel+f*2.),2.);fan+=beam*pulse*(.35+.65*hash(vec2(f,9.)));fine+=exp(-d*d/(w*w*.06))*(.4+.6*sin(r*3.-travel+f)*sin(r*3.-travel+f));}
 float centerGlow=exp(-r*r*5.);float fade=smoothstep(.04,.30,r)*exp(-r*.65);float cloud=fog(p*3.+vec2(travel*.12,-travel*.09));vec3 color=dark*.35+blue*(.018+cloud*.14+centerGlow*.13);color+=blue*fan*fade*(.7+n*1.6);color+=light*(fine*.06+fan*.58)*fade*(.18+n*n*1.8);color+=light*pow(cloud,5.)*.45;
 vec2 polar=vec2((ang/6.2831853+.5)*72.,log(max(r,.04))*8.-travel*1.15);vec2 cell=floor(polar),f=fract(polar)-.5;float seed=hash(cell);float dotGlow=exp(-dot(f,f)*150.)*step(.92,seed)*smoothstep(.28,.65,r);color+=light*dotGlow*particles*(.4+.6*seed);
 color*=mix(.48,1.,pow(max(0.,1.-length((uv0-.5)*vec2(1.05,1.))),.45));gl_FragColor=vec4(max(vec3(0),color*intensity),1.);#include <colorspace_fragment>
}`.replace(";#include", ";\n#include"),
    });
    this.scene.add(
      new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material),
    );
    this.fullResolution = false;
    this.copyScene = new THREE.Scene();
    this.copyMaterial = new THREE.MeshBasicMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.copyScene.add(
      new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copyMaterial),
    );
    this.target = null;
  }
  render(renderer, project, t, sample) {
    const c = project.scene.backdrop;
    if (!c?.enabled || t < (c.in ?? 0) || t > (c.out ?? project.duration))
      return false;
    const u = this.material.uniforms;
    for (const key of ["intensity", "rotation", "travel", "particles"])
      u[key].value = sample(c.tracks?.[key], t, c.base[key]);
    u.rotation.value *= Math.PI / 180;
    u.center.value.set(
      sample(c.tracks?.centerX, t, c.base.centerX),
      sample(c.tracks?.centerY, t, c.base.centerY),
    );
    u.aspect.value = project.aspect[0] / project.aspect[1];
    for (const key of ["dark", "blue", "light"])
      u[key].value.set(c.colors[key]);
    renderer.autoClear = true;
    if (this.fullResolution) {
      renderer.render(this.scene, this.camera);
    } else {
      const viewport = renderer.getViewport(new THREE.Vector4()),
        pixelRatio = renderer.getPixelRatio(),
        w = Math.max(
          2,
          Math.min(960, Math.round(viewport.z * pixelRatio * 0.5)),
        ),
        h = Math.max(2, Math.round((w * viewport.w) / viewport.z));
      if (!this.target) {
        const hdr = renderer.extensions.has("EXT_color_buffer_float");
        this.target = new THREE.WebGLRenderTarget(w, h, {
          depthBuffer: false,
          type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
        });
        this.target.texture.colorSpace = hdr
          ? THREE.LinearSRGBColorSpace
          : THREE.SRGBColorSpace;
        this.copyMaterial.map = this.target.texture;
      } else if (this.target.width !== w || this.target.height !== h)
        this.target.setSize(w, h);
      const oldTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(this.target);
      renderer.render(this.scene, this.camera);
      renderer.setRenderTarget(oldTarget);
      renderer.setViewport(viewport);
      renderer.render(this.copyScene, this.camera);
    }
    renderer.clearDepth();
    return true;
  }
}
