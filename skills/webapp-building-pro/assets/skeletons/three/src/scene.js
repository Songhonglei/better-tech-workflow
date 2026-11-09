import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// —— Determinism: every random draw goes through rand(); the global RNG is off-limits
//    (a re-render must reproduce the same frame, for screenshots and for diffing) ——
const SEED = 20260923;
function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);

// —— Scene contract (adjust values to subject size D): target = 0.4~0.6 of subject height, far>=5D, fog color = horizon color, distant masses beyond the fog required ——
const SKY = new THREE.Color(0x0b0e14);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = SKY;
scene.fog = new THREE.Fog(SKY, 30, 120); // near≈0.8~1.2D, far≈2.5~4.5D, tuned to the subject

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500);
camera.position.set(12, 9, 16);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 3, 0); // at 0.4~0.6 of the subject mass height
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x30241c, 0.9));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
sun.position.set(14, 22, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

// Ground (never shows an edge from any legal viewpoint) + subject placeholder (replace with real content)
const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 64).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x1a2030, roughness: 1 }));
ground.receiveShadow = true;
scene.add(ground);
const subject = new THREE.Mesh(new THREE.BoxGeometry(4, 6, 4),
  new THREE.MeshStandardMaterial({ color: 0x8899bb, roughness: 0.6 }));
subject.position.y = 3; subject.castShadow = true;
scene.add(subject);

// Scattered markers: seeded, so the layout is identical on every load
const marks = new THREE.Group();
for (let i = 0; i < 24; i++) {
  const a = rand() * Math.PI * 2, r = 10 + rand() * 60, h = 0.6 + rand() * 2.4;
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, h, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x2b3446, roughness: 0.9 }));
  m.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
  m.castShadow = true; m.receiveShadow = true;
  marks.add(m);
}
scene.add(marks);

// —— Time model: the scene is a pure function of t. sample(t) sets every animated
//    transform, so a live frame and __seek(t) produce the same picture; a looped
//    animation must be pixel-identical at t=0 and t=DURATION. ——
const DURATION = 12; // seconds per loop
function sample(t) {
  const phase = (t / DURATION) * Math.PI * 2;
  subject.rotation.y = phase;
  // A box is centrosymmetric, so spin alone renders t and t+DURATION/2 identically
  // and the self-check reads that as "?t= never reached __seek". Keep at least one
  // motion that separates half a loop from a whole one, and make it close on itself
  // at t=DURATION — 1-cos does, sin does not.
  subject.position.y = 3 + (1 - Math.cos(phase)) * 0.6;
}

const hud = document.getElementById('hud');
const clock = new THREE.Clock();
const STEP = 1 / 60;
let acc = 0, simT = 0, paused = false;

// —— HUD: live instrumentation, deliberately not part of the picture. A frame frozen
//    by __seek(t) has to be a pure function of t, and a clock reading is not — so the
//    HUD leaves the frame while the scene is parked and comes back on __play().
//    Counters belong here and never in the rendered scene: then two seeks a whole
//    loop apart stay pixel-identical no matter what the HUD grows to show. ——
function draw() {
  controls.update();
  renderer.render(scene, camera);
  hud.style.display = paused ? 'none' : '';
  if (!paused) hud.textContent = `t ${simT.toFixed(2)}s · calls ${renderer.info.render.calls} · tris ${renderer.info.render.triangles}`;
}

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!paused) {
    acc += dt;
    while (acc >= STEP) { acc -= STEP; simT += STEP; }   // fixed timestep
    sample(simT);
  }
  draw();
});

// Jump to an arbitrary moment; pauses so the frame holds still for a screenshot.
window.__seek = (t) => {
  const v = Number(t);
  paused = true; acc = 0;
  simT = Number.isFinite(v) && v > 0 ? v : 0;
  sample(simT);
  draw();
};
window.__play = () => { paused = false; clock.getDelta(); };

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (paused) draw();
});

sample(simT);
draw();
const T_PARAM = new URLSearchParams(location.search).get('t'); // ?t=<seconds> renders that moment
if (T_PARAM !== null) window.__seek(T_PARAM);
window.__SCENE_READY__ = true; // ready signal: for screenshot/self-check scripts to wait on
