// WebGL2 renderer: a procedural hex-floor background plus one instanced quad
// pipeline for every round thing (segments, food, eyes, glows).

const BG_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
void main() { gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }`;

const BG_FS = `#version 300 es
precision highp float;
uniform vec2 u_cam;
uniform float u_scale;
uniform vec2 u_res;
uniform float u_R;
uniform float u_time;
out vec4 o;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 w = vec2(fc.x - u_res.x * 0.5, u_res.y * 0.5 - fc.y) / u_scale + u_cam;

  vec2 uv = w / 58.0;
  const vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(uv, r) - h;
  vec2 b = mod(uv - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  vec2 id = uv - gv;
  vec2 q = abs(gv);
  float d = max(dot(q, normalize(r)), q.x);

  float n = hash(id);
  vec3 base = vec3(0.075, 0.085, 0.13) + n * 0.018;
  float bevel = smoothstep(0.5, 0.2, d);
  vec3 col = mix(vec3(0.035, 0.04, 0.065), base, bevel);
  col += vec3(0.02, 0.025, 0.04) * smoothstep(0.35, 0.0, length(gv + vec2(0.12, 0.14)));
  float px = 1.0 / (u_scale * 58.0);
  col = mix(col, vec3(0.02, 0.022, 0.035), smoothstep(0.47 - px, 0.5, d));

  float dist = length(w);
  float edge = dist - u_R;
  if (edge > 0.0) {
    col = mix(col * 0.35, vec3(0.16, 0.02, 0.04), 0.55);
  }
  float band = exp(-abs(edge) * 0.05) * (0.75 + 0.25 * sin(u_time * 3.0 + dist * 0.01));
  col += vec3(1.0, 0.18, 0.28) * band * 0.55;

  vec2 sv = fc / u_res - 0.5;
  col *= 1.0 - dot(sv, sv) * 0.9;
  o = vec4(col, 1.0);
}`;

const C_VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_inst;
layout(location=2) in vec4 a_col;
uniform vec2 u_cam;
uniform float u_scale;
uniform vec2 u_res;
out vec2 v_uv;
out vec4 v_col;
flat out float v_kind;
out float v_px;
void main() {
  vec2 world = a_inst.xy + a_corner * a_inst.z;
  vec2 p = (world - u_cam) * u_scale;
  gl_Position = vec4(p.x / (u_res.x * 0.5), -p.y / (u_res.y * 0.5), 0.0, 1.0);
  v_uv = a_corner;
  v_col = a_col;
  v_kind = a_inst.w;
  v_px = a_inst.z * u_scale;
}`;

const C_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_col;
flat in float v_kind;
in float v_px;
out vec4 o;
void main() {
  float d = length(v_uv);
  if (v_kind == 1.0) {
    float g = exp(-d * d * 4.0) * (1.0 - smoothstep(0.85, 1.0, d));
    o = vec4(v_col.rgb * g * v_col.a, 0.0);
    return;
  }
  float aa = 1.5 / max(v_px, 1.0);
  float cov = 1.0 - smoothstep(1.0 - aa, 1.0, d);
  if (cov <= 0.0) discard;
  vec3 c = v_col.rgb;
  if (v_kind == 0.0) {
    float z = sqrt(max(0.0, 1.0 - d * d));
    vec3 n = vec3(v_uv.x, v_uv.y, z);
    float diff = clamp(dot(n, normalize(vec3(-0.35, -0.55, 0.8))), 0.0, 1.0);
    c *= 0.32 + 0.8 * diff;
    float spec = pow(clamp(dot(n, normalize(vec3(-0.25, -0.5, 0.9))), 0.0, 1.0), 28.0);
    c += spec * 0.32;
    c *= mix(1.0, 0.5, smoothstep(0.72, 1.0, d));
  } else if (v_kind == 3.0) {
    c = mix(c, vec3(1.0), (1.0 - smoothstep(0.0, 0.55, d)) * 0.65);
  }
  o = vec4(c * cov * v_col.a, cov * v_col.a);
}`;

const FLOATS = 8;

export const KIND_BODY = 0;
export const KIND_GLOW = 1;
export const KIND_FLAT = 2;
export const KIND_FOOD = 3;

interface Batch {
  add: boolean;
  start: number;
  count: number;
}

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || "shader");
    gl.attachShader(p, sh);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link");
  return p;
}

export class Renderer {
  private gl: WebGL2RenderingContext;
  private bg: WebGLProgram;
  private circ: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private inst: WebGLBuffer;
  private data = new Float32Array(FLOATS * 32768);
  private n = 0;
  private batches: Batch[] = [];
  private bgU: Record<string, WebGLUniformLocation | null>;
  private cU: Record<string, WebGLUniformLocation | null>;
  width = 1;
  height = 1;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, premultipliedAlpha: true });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    this.bg = compile(gl, BG_VS, BG_FS);
    this.circ = compile(gl, C_VS, C_FS);
    const u = (p: WebGLProgram, names: string[]) =>
      Object.fromEntries(names.map((k) => [k, gl.getUniformLocation(p, k)]));
    this.bgU = u(this.bg, ["u_cam", "u_scale", "u_res", "u_R", "u_time"]);
    this.cU = u(this.circ, ["u_cam", "u_scale", "u_res"]);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.inst = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, FLOATS * 4, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, FLOATS * 4, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
  }

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  begin(): void {
    this.n = 0;
    this.batches.length = 0;
  }

  push(x: number, y: number, r: number, kind: number, cr: number, cg: number, cb: number, a: number): void {
    if (this.n * FLOATS >= this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    const add = kind === KIND_GLOW;
    const last = this.batches[this.batches.length - 1];
    if (last && last.add === add) last.count++;
    else this.batches.push({ add, start: this.n, count: 1 });
    const o = this.n * FLOATS;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = r; d[o + 3] = kind;
    d[o + 4] = cr; d[o + 5] = cg; d[o + 6] = cb; d[o + 7] = a;
    this.n++;
  }

  draw(camX: number, camY: number, scale: number, worldR: number, time: number): void {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.useProgram(this.bg);
    gl.uniform2f(this.bgU.u_cam, camX, camY);
    gl.uniform1f(this.bgU.u_scale, scale);
    gl.uniform2f(this.bgU.u_res, this.width, this.height);
    gl.uniform1f(this.bgU.u_R, worldR);
    gl.uniform1f(this.bgU.u_time, time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (this.n === 0) return;
    gl.useProgram(this.circ);
    gl.uniform2f(this.cU.u_cam, camX, camY);
    gl.uniform1f(this.cU.u_scale, scale);
    gl.uniform2f(this.cU.u_res, this.width, this.height);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    if (this.data.byteLength > gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE)) {
      gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.n * FLOATS);
    gl.enable(gl.BLEND);
    for (const b of this.batches) {
      if (b.add) gl.blendFunc(gl.ONE, gl.ONE);
      else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, FLOATS * 4, b.start * FLOATS * 4);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, FLOATS * 4, b.start * FLOATS * 4 + 16);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, b.count);
    }
    gl.bindVertexArray(null);
  }
}
