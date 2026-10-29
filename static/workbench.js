import { isScreen } from "./appearance.js";
import * as THREE from "./vendor/three/three.module.js";
import { OrbitControls } from "./vendor/three/addons/controls/OrbitControls.js";
import { TransformControls } from "./vendor/three/addons/controls/TransformControls.js";
const V = () => new THREE.Vector3(),
  clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export class Workbench {
  constructor(engine, canvas) {
    this.engine = engine;
    this.canvas = canvas;
    this.kind = "edit";
    this.visible = true;
    this.mode = "translate";
    this.space = "local";
    this.showAll = false;
    this.gridVisible = true;
    this.cameraVisible = false;
    this.pathVisible = true;
    this.pathDirty = true;
    this.pathObject = null;
    this.pathNode = null;
    this.pathBounds = new THREE.Box3();
    this.pathBuilds = 0;
    this.modal = null;
    this.state = null;
    this.callbacks = {};
    this.fine = false;
    this.ctrl = false;
    this.pointerUsed = false;
    this.mouse = null;
    this.orthoHeight = 16;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: false,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x171d25, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.localClippingEnabled = true;
    this.perspective = new THREE.PerspectiveCamera(50, 1, 0.05, 3000);
    this.perspective.position.set(13, 8, 16);
    this.orthographic = new THREE.OrthographicCamera(-8, 8, 8, -8, 0.05, 3000);
    this.camera = this.perspective;
    this.camera.layers.enableAll();
    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.target.set(0, 0, 0);
    this.orbit.enableDamping = false;
    this.orbit.dampingFactor = 0.18;
    this.orbit.mouseButtons = {
      LEFT: undefined,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: undefined,
    };
    this.orbit.screenSpacePanning = true;
    this.orbit.update();
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.environment = pm.fromEquirectangular(engine.envSource).texture;
    pm.dispose();
    this.helpers = new THREE.Scene();
    this.grid = new THREE.GridHelper(40, 40, 0x596879, 0x303d4c);
    this.grid.position.y = -4.5;
    this.axes = new THREE.AxesHelper(3);
    this.axes.position.copy(this.grid.position);
    this.cameraHelper = new THREE.CameraHelper(engine.camera);
    this.cameraHelper.material.depthTest = false;
    this.selectionBox = new THREE.Box3Helper(new THREE.Box3(), 0xe7bf73);
    this.selectionBox.material.depthTest = false;
    this.selectionBox.material.transparent = true;
    this.selectionBox.material.opacity = 0.5;
    this.helpers.add(
      this.grid,
      this.axes,
      this.cameraHelper,
      this.selectionBox,
    );
    this.pathGroup = new THREE.Group();
    this.pathLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0x7bc8ef,
        transparent: true,
        opacity: 0.88,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.pathLine.renderOrder = 20;
    this.pathEnds = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        size: 8,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.pathEnds.renderOrder = 21;
    this.pathCurrent = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints([V()]),
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 10,
        sizeAttenuation: false,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.pathCurrent.renderOrder = 22;
    this.pathGroup.add(this.pathLine, this.pathEnds, this.pathCurrent);
    this.helpers.add(this.pathGroup);
    this.gizmoScene = new THREE.Scene();
    this.proxy = new THREE.Object3D();
    this.gizmoScene.add(this.proxy);
    this.controls = new TransformControls(this.camera, canvas);
    this.controls.setMode(this.mode);
    this.controls.setSpace(this.space);
    this.controls.setSize(0.95);
    for (let group of [
      this.controls._gizmo.gizmo.rotate,
      this.controls._gizmo.picker.rotate,
    ])
      for (let child of [...group.children])
        if (["E", "XYZE"].includes(child.name)) group.remove(child);
    for (let mode of ["translate", "rotate", "scale"])
      this.controls._gizmo.gizmo[mode].traverse((o) => {
        if (o.material && ["X", "Y", "Z"].includes(o.name))
          o.material.color.set(
            { X: 0xff6873, Y: 0x76d58e, Z: 0x6eafff }[o.name],
          );
      });
    this.gizmoScene.add(this.controls);
    this.controls.addEventListener("mouseDown", () => {
      this.pointerUsed = true;
      this.orbit.enabled = false;
      this.callbacks.start?.(this);
    });
    this.controls.addEventListener("objectChange", () =>
      this.callbacks.change?.(this),
    );
    this.controls.addEventListener("mouseUp", () => this.callbacks.end?.(this));
    canvas.style.touchAction = "none";
    canvas.addEventListener(
      "pointerdown",
      () => {
        if (!this.modal) this.pointerUsed = false;
        this.callbacks.activate?.();
      },
      true,
    );
    canvas.addEventListener("pointermove", (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("click", (e) => {
      if (this.pointerUsed) {
        this.pointerUsed = false;
        return;
      }
      if (this.controls.axis || this.modal) return;
      this.callbacks.select?.(this.pick(e.clientX, e.clientY));
    });
    canvas.addEventListener("dblclick", () => {
      if (!this.modal) this.frameSelected();
    });
    window.addEventListener("pointermove", (e) => {
      if (this.modal) {
        this.mouse = { x: e.clientX, y: e.clientY };
        this.fine = e.shiftKey;
        this.ctrl = e.ctrlKey;
        this.updateModal();
      }
    });
    window.addEventListener(
      "pointerdown",
      (e) => {
        if (!this.modal) return;
        if (e.target.closest?.("#viewClose,#viewToggle")) {
          this.callbacks.cancel?.();
          return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        this.pointerUsed = true;
        if (e.button === 0) this.callbacks.end?.(this);
        else if (e.button === 2) this.callbacks.cancel?.();
      },
      true,
    );
    canvas.addEventListener("pointercancel", () => this.callbacks.cancel?.());
  }
  invalidatePath() {
    this.pathDirty = true;
  }
  pathPoint(o, t) {
    if (o.type === "camera") {
      const v = this.engine.motionValues(o, t);
      return new THREE.Vector3(v.x, v.y, v.z);
    }
    return V().applyMatrix4(this.engine.pose(o, t).matrix);
  }
  updatePath(project, t, id) {
    const o = project.objects.find((o) => o.id === id);
    this.pathGroup.visible = !!(this.pathVisible && o?.enabled && !isScreen(o));
    if (!this.pathGroup.visible) return;
    const node = this.engine.nodes.get(id);
    if (this.pathDirty || this.pathObject !== o || this.pathNode !== node) {
      const times = new Set([o.in, o.out]),
        count = clamp(Math.ceil((o.out - o.in) * project.fps * 2), 64, 1800);
      for (let i = 1; i < count; i++)
        times.add(o.in + ((o.out - o.in) * i) / count);
      for (const [ch, keys] of Object.entries(o.tracks))
        if (!["opacity", "reveal"].includes(ch))
          for (const k of keys)
            if (k.time > o.in && k.time < o.out) times.add(k.time);
      let ts = [...times].sort((a, b) => a - b);
      if (ts.length > 4096) {
        const all = ts;
        ts = Array.from(
          { length: 4096 },
          (_, i) => all[Math.round((i * (all.length - 1)) / 4095)],
        );
      }
      // A drag preview is a temporary pose, not a key at every time. Sample saved tracks only.
      const motion = this.engine.previewMotion,
        rotation = this.engine.previewRotation;
      let pts;
      try {
        this.engine.previewMotion = null;
        this.engine.previewRotation = null;
        pts = ts.map((time) => this.pathPoint(o, time));
      } finally {
        this.engine.previewMotion = motion;
        this.engine.previewRotation = rotation;
      }
      this.pathLine.geometry.dispose();
      this.pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      this.pathEnds.geometry.dispose();
      this.pathEnds.geometry = new THREE.BufferGeometry().setFromPoints([
        pts[0],
        pts.at(-1),
      ]);
      this.pathEnds.geometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(
          [
            ...new THREE.Color(0x75d99b).toArray(),
            ...new THREE.Color(0xf1b568).toArray(),
          ],
          3,
        ),
      );
      this.pathBounds.setFromPoints(pts);
      this.pathTimes = ts;
      this.pathObject = o;
      this.pathNode = node;
      this.pathDirty = false;
      this.pathBuilds++;
    }
    this.pathCurrent.visible = this.showAll || (t >= o.in && t <= o.out);
    const point = this.pathPoint(o, t),
      attr = this.pathCurrent.geometry.getAttribute("position");
    attr.setXYZ(0, point.x, point.y, point.z);
    attr.needsUpdate = true;
    this.pathCurrent.geometry.computeBoundingSphere();
  }
  framePath() {
    if (!this.project || !this.visible) return;
    this.updatePath(this.project, this.time, this.id);
    if (this.pathGroup.visible)
      this.frameBounds(this.pathBounds.clone().union(this.bounds(false)));
  }
  setCallbacks(callbacks) {
    this.callbacks = callbacks;
  }
  setMode(mode) {
    if (this.modal || this.controls.dragging) return;
    this.mode = mode;
    this.controls.setMode(mode);
    if (this.project)
      this.sync(this.project, this.time, this.id, this.target, true);
    this.callbacks.ui?.();
  }
  setSpace(space) {
    this.space = space;
    this.controls.setSpace(this.mode === "scale" ? "local" : space);
    this.callbacks.ui?.();
  }
  setVisible(show) {
    this.visible = show;
    if (!show) {
      if (this.modal || this.controls.dragging) this.callbacks.cancel?.();
      this.controls.enabled = false;
      this.controls.detach();
      this.orbit.enabled = false;
    } else {
      this.orbit.enabled = true;
      this.resize();
    }
    this.callbacks.ui?.();
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.renderer.setSize(rect.width, rect.height, false);
    const a = rect.width / rect.height;
    this.perspective.aspect = a;
    this.perspective.updateProjectionMatrix();
    this.orthographic.left = (-this.orthoHeight * a) / 2;
    this.orthographic.right = (this.orthoHeight * a) / 2;
    this.orthographic.top = this.orthoHeight / 2;
    this.orthographic.bottom = -this.orthoHeight / 2;
    this.orthographic.updateProjectionMatrix();
  }
  sync(project, t, id, target, enabled = true) {
    this.project = project;
    this.time = t;
    this.id = id;
    this.target = target;
    if (this.modal || this.controls.dragging) return;
    const o = project.objects.find((o) => o.id === id),
      can =
        this.visible &&
        enabled &&
        o &&
        o.type !== "camera" &&
        !isScreen(o) &&
        o.enabled &&
        (this.showAll || (t >= o.in && t <= o.out));
    this.controls.enabled = !!can;
    this.orbit.enabled = !!this.visible;
    this.state = null;
    if (!can) {
      this.controls.detach();
      return;
    }
    const pose = this.engine.pose(o, t),
      parent = target === "parent",
      v = pose.v;
    this.proxy.position.copy(parent ? pose.orbitWorld : pose.pivotWorld);
    this.proxy.quaternion.copy(parent ? pose.parentQ : pose.orientation);
    this.proxy.scale.set(
      ...(this.mode === "scale"
        ? parent
          ? [v.gsx, v.gsy, v.gsz]
          : [v.sx, v.sy, v.sz]
        : [1, 1, 1]),
    );
    this.controls.setSpace(this.mode === "scale" ? "local" : this.space);
    if (this.controls.object !== this.proxy) this.controls.attach(this.proxy);
    this.state = {
      id,
      mode: this.mode,
      target,
      channel: parent ? "groupRotation" : "rotation",
      pose,
    };
    this.gizmoScene.updateMatrixWorld(true);
  }
  render(project, t, id, target, enabled = true) {
    if (!this.visible) return;
    this.orbit.update();
    this.sync(project, t, id, target, enabled);
    this.camera.layers.enableAll();
    this.camera.updateMatrixWorld();
    let scene = this.engine.scene,
      oldEnv = scene.environment,
      visibility = [];
    if (this.showAll)
      for (let o of project.objects) {
        const n = this.engine.nodes.get(o.id);
        if (n) {
          visibility.push([n, n.visible]);
          n.visible = o.enabled;
        }
      }
    try {
      scene.environment = this.environment;
      this.renderer.toneMappingExposure = project.scene.exposure;
      this.renderer.autoClear = true;
      this.renderer.render(scene, this.camera);
      this.renderer.autoClear = false;
      this.grid.visible = this.axes.visible = this.gridVisible;
      this.cameraHelper.visible = this.cameraVisible;
      this.cameraHelper.update();
      const selected = this.engine.nodes.get(id);
      this.selectionBox.visible =
        !!selected?.visible &&
        !isScreen(project.objects.find((o) => o.id === id));
      if (selected && !isScreen(project.objects.find((o) => o.id === id))) {
        this.selectionBox.box.setFromObject(selected);
        if (this.selectionBox.box.isEmpty()) this.selectionBox.visible = false;
      }
      this.updatePath(project, t, id);
      this.renderer.render(this.helpers, this.camera);
      if (this.controls.visible) {
        this.renderer.clearDepth();
        this.renderer.render(this.gizmoScene, this.camera);
      }
    } finally {
      scene.environment = oldEnv;
      visibility.forEach(([node, v]) => (node.visible = v));
    }
  }
  pick(x, y) {
    let r = this.canvas.getBoundingClientRect(),
      ray = new THREE.Raycaster();
    ray.layers.enableAll();
    ray.setFromCamera(
      new THREE.Vector2(
        ((x - r.left) / r.width) * 2 - 1,
        1 - ((y - r.top) / r.height) * 2,
      ),
      this.camera,
    );
    return ray
      .intersectObjects([...this.engine.nodes.values()], true)
      .find((hit) => {
        let n = this.engine.nodes.get(hit.object.userData.id),
          o = this.project?.objects.find(
            (o) => o.id === hit.object.userData.id,
          );
        return o?.enabled && !isScreen(o) && (n?.visible || this.showAll);
      })?.object.userData.id;
  }
  bounds(all = false) {
    let box = new THREE.Box3();
    for (let [id, n] of this.engine.nodes)
      if (
        (all ? n.visible || this.showAll : id === this.id) &&
        this.project?.objects.find((o) => o.id === id)?.enabled &&
        !isScreen(this.project?.objects.find((o) => o.id === id))
      )
        box.union(new THREE.Box3().setFromObject(n));
    return box;
  }
  frameSelected(all = false) {
    this.frameBounds(this.bounds(all));
  }
  frameBounds(box) {
    if (this.modal || this.controls.dragging || box.isEmpty()) return;
    let sphere = box.getBoundingSphere(new THREE.Sphere()),
      radius = Math.max(0.3, sphere.radius),
      direction = this.camera.position
        .clone()
        .sub(this.orbit.target)
        .normalize();
    this.orbit.target.copy(sphere.center);
    this.camera.far = Math.max(3000, radius * 40);
    if (this.camera.isPerspectiveCamera) {
      let fov = Math.min(
        (this.camera.fov * Math.PI) / 180,
        2 *
          Math.atan(
            Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.aspect,
          ),
      );
      this.camera.position
        .copy(sphere.center)
        .addScaledVector(direction, (radius / Math.sin(fov / 2)) * 1.15);
    } else {
      this.orthoHeight =
        (radius * 2.4) /
        Math.min(1, this.canvas.clientWidth / this.canvas.clientHeight);
      this.camera.zoom = 1;
      this.camera.position
        .copy(sphere.center)
        .addScaledVector(direction, radius * 4 + 10);
    }
    this.camera.updateProjectionMatrix();
    this.resize();
    this.orbit.update();
    this.callbacks.ui?.();
  }
  setView(name, opposite = false) {
    if (this.modal) return;
    let distance = Math.max(
        3,
        this.camera.position.distanceTo(this.orbit.target),
      ),
      dir = { front: [0, 0, 1], right: [1, 0, 0], top: [0, 1, 0.000001] }[name];
    if (!dir) return;
    this.camera.up.set(0, 1, 0);
    this.camera.position
      .copy(this.orbit.target)
      .addScaledVector(
        new THREE.Vector3(...dir).normalize(),
        distance * (opposite ? -1 : 1),
      );
    this.camera.lookAt(this.orbit.target);
    this.orbit.update();
    this.callbacks.ui?.();
  }
  toggleProjection() {
    if (this.modal) return;
    let old = this.camera,
      next = old.isPerspectiveCamera ? this.orthographic : this.perspective;
    next.position.copy(old.position);
    next.quaternion.copy(old.quaternion);
    next.up.copy(old.up);
    next.layers.enableAll();
    if (next.isOrthographicCamera) {
      this.orthoHeight =
        2 *
        old.position.distanceTo(this.orbit.target) *
        Math.tan((old.fov * Math.PI) / 360);
      next.zoom = 1;
    } else {
      let h = (old.top - old.bottom) / old.zoom,
        d = h / (2 * Math.tan((next.fov * Math.PI) / 360));
      next.position
        .copy(this.orbit.target)
        .addScaledVector(
          old.position.clone().sub(this.orbit.target).normalize(),
          d,
        );
    }
    this.camera = next;
    this.orbit.object = next;
    this.controls.camera = next;
    this.resize();
    this.orbit.update();
    this.callbacks.ui?.();
  }
  cameraView() {
    if (this.modal) return;
    if (this.camera.isOrthographicCamera) this.toggleProjection();
    let ref = this.engine.camera;
    this.camera.position.copy(ref.position);
    this.camera.quaternion.copy(ref.quaternion);
    this.camera.up.set(0, 1, 0).applyQuaternion(ref.quaternion);
    this.camera.fov = ref.fov;
    this.orbit.target
      .copy(ref.position)
      .addScaledVector(ref.getWorldDirection(V()), 15);
    this.camera.updateProjectionMatrix();
    this.orbit.update();
    this.callbacks.ui?.();
  }
  updateModifiers(e) {
    this.fine = !!e.shiftKey;
    this.ctrl = !!e.ctrlKey;
    this.controls.setTranslationSnap(this.ctrl ? 1 : null);
    this.controls.setRotationSnap(this.ctrl ? (5 * Math.PI) / 180 : null);
    this.controls.setScaleSnap(this.ctrl ? 0.1 : null);
    if (this.modal) this.updateModal();
  }
  finish() {
    this.modal = null;
    this.controls.dragging = false;
    this.controls.axis = null;
    this.orbit.enabled = this.visible;
    this.controls.enabled = this.visible;
    this.callbacks.ui?.();
  }
  abort() {
    this.controls.reset();
    this.finish();
  }
  beginKeyboard(mode) {
    if (!this.visible || !this.state) return false;
    if (this.controls.dragging) return true;
    if (this.modal) this.callbacks.cancel?.();
    this.setMode(mode);
    this.sync(this.project, this.time, this.id, this.target, true);
    if (!this.state) return false;
    const rect = this.canvas.getBoundingClientRect(),
      point = this.proxy.position.clone().project(this.camera),
      center = {
        x: rect.left + ((point.x + 1) * rect.width) / 2,
        y: rect.top + ((1 - point.y) * rect.height) / 2,
      },
      mouse = this.mouse || { x: center.x + 100, y: center.y };
    this.modal = {
      mode,
      axis: null,
      plane: false,
      axisSpace: "world",
      typed: "",
      position: this.proxy.position.clone(),
      quaternion: this.proxy.quaternion.clone(),
      scale: this.proxy.scale.clone(),
      startMouse: { ...mouse },
      center,
      viewNormal: this.camera.getWorldDirection(V()).negate(),
    };
    this.modal.startHit = this.hitPlane(
      mouse,
      this.modal.position,
      this.modal.viewNormal,
    );
    this.orbit.enabled = false;
    this.controls.enabled = false;
    this.callbacks.start?.(this);
    this.callbacks.ui?.();
    return true;
  }
  hitPlane(mouse, point, normal) {
    let r = this.canvas.getBoundingClientRect(),
      ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(
        ((mouse.x - r.left) / r.width) * 2 - 1,
        1 - ((mouse.y - r.top) / r.height) * 2,
      ),
      this.camera,
    );
    return ray.ray.intersectPlane(
      new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point),
      V(),
    );
  }
  updateModal() {
    let m = this.modal;
    if (!m) return;
    let mouse = this.mouse || m.startMouse,
      dx = mouse.x - m.startMouse.x,
      dy = mouse.y - m.startMouse.y,
      numeric = m.typed !== "" && Number.isFinite(Number(m.typed)),
      number = Number(m.typed),
      axis = m.axis
        ? new THREE.Vector3(
            ...{ X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }[m.axis],
          )
        : null;
    if (axis && m.axisSpace === "local") axis.applyQuaternion(m.quaternion);
    const fine = this.fine ? 0.1 : 1;
    if (m.mode === "translate") {
      let hit = this.hitPlane(mouse, m.position, m.viewNormal),
        delta = hit && m.startHit ? hit.sub(m.startHit) : V();
      if (axis) {
        if (m.plane) delta.addScaledVector(axis, -delta.dot(axis));
        else
          delta
            .copy(axis)
            .multiplyScalar(numeric ? number : delta.dot(axis) * fine);
      } else if (!numeric) delta.multiplyScalar(fine);
      if (m.plane && !numeric) delta.multiplyScalar(fine);
      if (numeric && (!axis || m.plane)) {
        if (delta.lengthSq() < 1e-10) {
          delta.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
          if (axis) delta.addScaledVector(axis, -delta.dot(axis));
        }
        delta.normalize().multiplyScalar(number);
      }
      if (this.ctrl && !numeric) {
        if (axis && !m.plane) {
          delta.copy(axis).multiplyScalar(Math.round(delta.dot(axis)));
        } else
          delta.set(
            Math.round(delta.x),
            Math.round(delta.y),
            Math.round(delta.z),
          );
      }
      this.proxy.position.copy(m.position).add(delta);
      m.measure = delta.length().toFixed(3);
    }
    if (m.mode === "rotate") {
      let angle;
      if (numeric) angle = (number * Math.PI) / 180;
      else if (axis) angle = (dx - dy) * 0.01 * fine;
      else {
        let a = Math.atan2(
            m.center.y - m.startMouse.y,
            m.startMouse.x - m.center.x,
          ),
          b = Math.atan2(m.center.y - mouse.y, mouse.x - m.center.x);
        angle = (b - a) * fine;
      }
      if (this.ctrl && !numeric)
        angle = Math.round(angle / (Math.PI / 36)) * (Math.PI / 36);
      this.proxy.quaternion.copy(
        new THREE.Quaternion()
          .setFromAxisAngle(axis || m.viewNormal, angle)
          .multiply(m.quaternion),
      );
      m.measure = ((angle * 180) / Math.PI).toFixed(2) + "°";
    }
    if (m.mode === "scale") {
      let factor = numeric ? number : 1 + ((dx - dy) / 180) * fine;
      if (this.ctrl && !numeric) factor = Math.round(factor * 10) / 10;
      factor = Math.max(0.001, factor);
      this.proxy.scale.copy(m.scale);
      for (let i = 0; i < 3; i++)
        if (!m.axis || (m.plane ? "XYZ"[i] !== m.axis : "XYZ"[i] === m.axis))
          this.proxy.scale.setComponent(
            i,
            Math.max(0.001, m.scale.getComponent(i) * factor),
          );
      m.measure = factor.toFixed(3) + "×";
    }
    this.proxy.updateMatrixWorld();
    this.callbacks.change?.(this);
    this.callbacks.ui?.();
  }
  handleKey(e) {
    if (!this.visible) return false;
    this.updateModifiers(e);
    if (this.modal) {
      if (e.code === "Escape") {
        this.callbacks.cancel?.();
        return true;
      }
      if (e.code === "Enter" || e.code === "NumpadEnter") {
        this.callbacks.end?.(this);
        return true;
      }
      if (["KeyX", "KeyY", "KeyZ"].includes(e.code)) {
        let axis = e.code.at(-1),
          m = this.modal;
        m.axisSpace =
          m.mode === "scale"
            ? "local"
            : m.axis === axis
              ? m.axisSpace === "world"
                ? "local"
                : "world"
              : "world";
        m.axis = axis;
        m.plane = e.shiftKey;
        this.updateModal();
        return true;
      }
      if (["KeyG", "KeyR", "KeyS"].includes(e.code)) {
        this.beginKeyboard(
          { KeyG: "translate", KeyR: "rotate", KeyS: "scale" }[e.code],
        );
        return true;
      }
      if (/^[0-9.+-]$/.test(e.key)) {
        if (e.key === "-" || e.key === "+")
          this.modal.typed =
            e.key === "-"
              ? this.modal.typed.startsWith("-")
                ? this.modal.typed.slice(1)
                : "-" + this.modal.typed
              : this.modal.typed.replace(/^-/, "");
        else if (e.key !== "." || !this.modal.typed.includes("."))
          this.modal.typed += e.key;
        this.updateModal();
        return true;
      }
      if (e.code === "Backspace") {
        this.modal.typed = this.modal.typed.slice(0, -1);
        this.updateModal();
        return true;
      }
      return true;
    }
    if (["KeyG", "KeyR", "KeyS"].includes(e.code))
      return this.beginKeyboard(
        { KeyG: "translate", KeyR: "rotate", KeyS: "scale" }[e.code],
      );
    if (e.code === "Numpad1") {
      this.setView("front", e.ctrlKey);
      return true;
    }
    if (e.code === "Numpad3") {
      this.setView("right", e.ctrlKey);
      return true;
    }
    if (e.code === "Numpad7") {
      this.setView("top", e.ctrlKey);
      return true;
    }
    if (e.code === "Numpad5") {
      this.toggleProjection();
      return true;
    }
    if (e.code === "Numpad0") {
      this.cameraView();
      return true;
    }
    if (e.code === "NumpadDecimal" || e.code === "Home") {
      this.frameSelected(e.code === "Home");
      return true;
    }
    return false;
  }
  description() {
    if (this.modal) {
      let m = this.modal;
      return `${{ translate: "G 移动", rotate: "R 旋转", scale: "S 缩放" }[m.mode]} ${m.plane ? "排除 " : ""}${m.axis || "自由"} · ${m.axisSpace === "local" ? "局部" : "世界"} · ${m.typed || m.measure || ""} ｜ Enter 确认 · Esc 取消`;
    }
    return `${this.camera.isOrthographicCamera ? "正交" : "透视"} · ${this.target === "parent" ? "父级" : "对象"} · ${this.mode === "scale" ? "局部缩放" : this.space === "local" ? "局部坐标" : "世界坐标"}`;
  }
}
