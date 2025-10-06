import vertexShaderSrc from './vertex.glsl.js';
import fragmentShaderSrc from './fragment.glsl.js';

let gl, program, vao = null, vertexCount = 0;
let uniformModelViewLoc, uniformProjectionLoc;

// Mouse-driven deltas
let rotY = 0;      // radians (mouse)
let rotZ = 0;      // radians (mouse)
let panX = 0, panY = 0, panZ = 0;  // <-- panY added

// ===== UI readers (no event dependence; read every frame) =====
function uiRotY() {
  const s = document.getElementById('rotation');
  return s ? (Number(s.value) * Math.PI / 180) : 0;
}
function uiZoom() {
  const s = document.getElementById('scale');
  const v = s ? Number(s.value) : 60;
  return 0.6 + (200 - v) / 100;
}
function uiHeightScale() {
  const s = document.getElementById('height');
  return s ? Number(s.value) / 50 : 1.0;
}
function uiProjMode() {
  const sel = document.getElementById('projectionSelect');
  return sel ? sel.value : 'perspective';
}

// ===== DEM processing (pure canvas) =====
function processImage(img) {
  const sw = img.width, sh = img.height;
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, sw, sh);
  const { data } = ctx.getImageData(0, 0, sw, sh);

  const heights = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4;
      const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255.0;
      heights[y * sw + x] = lum;
    }
  }
  return { width: sw, height: sh, data: heights };
}

// ===== Mesh builder (two triangles per cell) =====
function buildMesh(hm) {
  const w = hm.width, h = hm.height, d = hm.data;
  const triCount = (w - 1) * (h - 1) * 2;
  const positions = new Float32Array(triCount * 3 * 3);

  const nx = x => (x / (w - 1)) * 2 - 1;
  const nz = y => (y / (h - 1)) * 2 - 1;

  let p = 0;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const x0 = nx(x), x1 = nx(x + 1);
      const z0 = nz(y), z1 = nz(y + 1);

      const y00 = d[y * w + x];
      const y10 = d[y * w + x + 1];
      const y01 = d[(y + 1) * w + x];
      const y11 = d[(y + 1) * w + x + 1];

      // Triangle A
      positions[p++] = x0; positions[p++] = y00; positions[p++] = z0;
      positions[p++] = x1; positions[p++] = y10; positions[p++] = z0;
      positions[p++] = x0; positions[p++] = y01; positions[p++] = z1;

      // Triangle B
      positions[p++] = x1; positions[p++] = y10; positions[p++] = z0;
      positions[p++] = x1; positions[p++] = y11; positions[p++] = z1;
      positions[p++] = x0; positions[p++] = y01; positions[p++] = z1;
    }
  }
  return positions;
}

function uploadMesh(positions) {
  const posBuf = createBuffer(gl, gl.ARRAY_BUFFER, positions);
  const posLoc = gl.getAttribLocation(program, 'position');
  vao = createVAO(gl, posLoc, posBuf);
  vertexCount = positions.length / 3;
}

// ===== File input =====
function hookFile() {
  const input = document.getElementById('fileInput');
  if (!input) return;
  input.addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const hm = processImage(img);
        const mesh = buildMesh(hm);
        uploadMesh(mesh);

        // Centered, clean default view on import
        rotY = 0; rotZ = 0; panX = 0; panY = 0; panZ = 0; // <-- reset panY too
        const r = document.getElementById('rotation'); if (r) r.value = '0';
        const sc = document.getElementById('scale');   if (sc) sc.value = '80'; // closer default
        const h = document.getElementById('height');   if (h) h.value = '50';
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  });
}

// ===== Mouse interactions (no libs) =====
function hookMouse(canvas) {
  let isLeft = false, isRight = false, lastX = 0, lastY = 0;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) isLeft = true;
    if (e.button === 2) isRight = true;
    lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener('mouseup', () => { isLeft = false; isRight = false; });
  window.addEventListener('mousemove', (e) => {
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (isLeft) {
      rotY += dx * 0.01; 
      rotZ += dy * 0.01; 
    } else if (isRight) {
		if (e.shiftKey) {            
			panX += dx * 0.003;
			panY += -dy * 0.003;
		} else {                     
			panX += dx * 0.003;
			panZ += dy * 0.003;
		}
	}
  });

  canvas.addEventListener('wheel', (e) => {
	e.preventDefault();
	const sc = document.getElementById('scale');
	if (!sc) return;

	const projMode = uiProjMode();
	const scrollingIn = (e.deltaY < 0);
	let step = scrollingIn ? 8 : -8;
	if (projMode === 'orthographic') step = -step;

	const v = Number(sc.value);
	const nv = Math.max(0, Math.min(200, v + step));
	sc.value = String(nv);
	}, { passive: false });
}

// ===== Resize for device pixel ratio =====
function resizeCanvas() {
  const c = document.getElementById('glcanvas');
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (c.width !== w * dpr || c.height !== h * dpr) {
    c.width = w * dpr;
    c.height = h * dpr;
  }
}

// ===== Draw loop =====
function draw() {
  resizeCanvas();

  const canvas = gl.canvas;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.15, 0.15, 0.16, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);

  const aspect = canvas.width / canvas.height;
  const projMode = uiProjMode();
  const zoom = uiZoom();
  const hS = uiHeightScale();
  const sliderRotY = uiRotY();

  let projection;
  if (projMode === 'orthographic') {
    const base = 1.2;
    const scale = base * (1 / zoom);
    const left = -scale * aspect, right = scale * aspect, bottom = -scale, top = scale;
    projection = orthographicMatrix(left, right, bottom, top, 0.01, 50.0);
  } else {
    projection = perspectiveMatrix(70 * Math.PI / 180, aspect, 0.01, 50.0);
  }

  // Camera (lowered Y so it doesn't "look down" too steeply)
  const eye = (projMode === 'perspective')
    ? [0, 1.2, 2.8 * zoom] 
    : [0, 1.2, 3.0];

  const lift = (projMode === 'perspective') ? 1.20 : 0.90;
  const view = lookAt(eye, [0, lift, 0], [0, 1, 0]);

  const model = multiplyArrayOfMatrices([
    translateMatrix(panX, (lift - 0.5 * hS) + panY, panZ),
    rotateYMatrix(sliderRotY + rotY),
    rotateZMatrix(rotZ),
    scaleMatrix(1, hS, 1)
  ]);

  const modelview = multiplyMatrices(view, model);

  gl.useProgram(program);
  gl.uniformMatrix4fv(uniformProjectionLoc, false, new Float32Array(projection));
  gl.uniformMatrix4fv(uniformModelViewLoc, false, new Float32Array(modelview));

  if (vao && vertexCount > 0) {
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
  }

  requestAnimationFrame(draw);
}

// ===== Init =====
function initialize() {
  const canvas = document.getElementById('glcanvas');
  gl = canvas.getContext('webgl2');
  if (!gl) {
    alert('WebGL2 not supported');
    return;
  }

  const vs = createShader(gl, gl.VERTEX_SHADER, vertexShaderSrc);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSrc);
  program = createProgram(gl, vs, fs);

  uniformModelViewLoc = gl.getUniformLocation(program, 'modelview');
  uniformProjectionLoc = gl.getUniformLocation(program, 'projection');

  hookFile();
  hookMouse(canvas);
  requestAnimationFrame(draw);
}

window.addEventListener('load', initialize);
