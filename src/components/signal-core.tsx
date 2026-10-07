"use client";

import { useEffect, useRef } from "react";
import { useApp, type CoreState } from "@/lib/store";

/**
 * MARKETING SIGNAL CORE — WebGL thematic heart of ՀայDev Marketing.
 * Symbolizes business → trends → generation → publishing → analytics.
 * Raw WebGL (no heavy deps), single quad, DPR-capped, pauses when tab hidden,
 * static frame under prefers-reduced-motion. Never blocks scroll (pointer-events none).
 */

const VERT = `attribute vec2 a_pos; void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_state; // 0 idle 1 analyzing 2 trend 3 planning 4 generating 5 publishing 6 success 7 error

vec3 neonViolet = vec3(0.545, 0.361, 0.965);
vec3 neonMint   = vec3(0.133, 0.827, 0.933);
vec3 neonAmber  = vec3(0.133, 0.827, 0.933);
vec3 neonRed    = vec3(0.98, 0.30, 0.30);

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);
  float t = u_time;

  vec3 colA = neonViolet;
  vec3 colB = neonMint;
  float speed = 0.6;
  float rings = 0.0;
  float pulse = 0.0;
  float turbulence = 0.0;

  if (u_state < 0.5) { speed = 0.35; }                         // IDLE — slow breathing
  else if (u_state < 1.5) { colA = neonMint; speed = 1.2; turbulence = 0.6; }   // ANALYZING
  else if (u_state < 2.5) { colA = neonAmber; colB = neonViolet; speed = 1.6; } // TREND_SEARCH
  else if (u_state < 3.5) { colA = neonViolet; speed = 0.9; rings = 1.0; }      // PLANNING
  else if (u_state < 4.5) { colA = neonViolet; colB = neonAmber; speed = 2.6; pulse = 1.0; } // GENERATING
  else if (u_state < 5.5) { colA = neonMint; speed = 1.8; rings = 1.0; }        // PUBLISHING
  else if (u_state < 6.5) { colA = neonMint; speed = 0.2; }                     // SUCCESS
  else { colA = neonRed; colB = neonViolet; speed = 3.0; pulse = 1.0; }         // ERROR

  float r = length(uv);
  float breath = 0.36 + 0.06 * sin(t * speed) + 0.03 * pulse * sin(t * speed * 4.0);

  // Core orb
  float core = smoothstep(breath + 0.02, breath - 0.02, r);
  // Energy rings
  float ringWave = sin(r * 22.0 - t * speed * 2.2) * 0.5 + 0.5;
  float ringMask = smoothstep(0.02, 0.0, abs(r - (breath + 0.05 + 0.05 * sin(t * speed))));
  float ringsOut = ringWave * ringMask * (0.35 + 0.65 * rings);

  // Turbulent filament noise
  float n = noise(uv * 5.0 + vec2(t * 0.35 * speed, -t * 0.25 * speed));
  float n2 = noise(uv * 9.0 - vec2(t * 0.5 * speed, t * 0.3 * speed));
  float filaments = smoothstep(0.55, 0.95, n * 0.6 + n2 * 0.4) * (0.25 + turbulence * 0.55);

  // Halo
  float halo = exp(-r * 3.2) * 0.35;

  vec3 col = mix(colA, colB, clamp(0.5 + 0.5 * sin(t * 0.4), 0.0, 1.0));
  vec3 result = vec3(0.02, 0.015, 0.045);
  float sphereZ = sqrt(max(0.0, 1.0 - dot(uv / breath, uv / breath)));
  float edgeLight = pow(1.0 - sphereZ, 2.5);
  float surfaceNoise = noise(uv * 34.0 + vec2(t * 0.035, 0.0));
  result += core * (col * (0.08 + edgeLight * 0.9) + vec3(0.05, 0.13, 0.28) * sphereZ);
  result += core * step(0.84, surfaceNoise) * vec3(0.18, 0.3, 0.48);
  result += col * halo;
  result += col * ringsOut * 0.8;
  result += col * filaments * 0.35;
  result += core * vec3(0.22, 0.32, 0.55) * pow(max(0.0, dot(normalize(vec3(uv, sphereZ)), normalize(vec3(-0.4, 0.6, 0.7)))), 12.0);

  // Vignette
  result *= 1.0 - 0.55 * smoothstep(0.4, 1.1, r);

  gl_FragColor = vec4(result, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  return sh;
}

export function SignalCore({ className, state }: { className?: string; state?: CoreState }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const coreState = useApp((s) => s.coreState);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || window.matchMedia("(max-width: 767px)").matches) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!gl) return; // graceful degradation: parent shows static gradient

    const prog = gl.createProgram()!;
    const vertex = compile(gl, gl.VERTEX_SHADER, VERT);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    gl.attachShader(prog, vertex);
    gl.attachShader(prog, fragment);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "u_res");
    const uTime = gl.getUniformLocation(prog, "u_time");
    const uState = gl.getUniformLocation(prog, "u_state");

    const stateMap: Record<string, number> = {
      IDLE: 0,
      WAITING_APPROVAL: 3,
      AUTOPILOT_ACTIVE: 5,
      ANALYZING: 1,
      TREND_SEARCH: 2,
      PLANNING: 3,
      GENERATING: 4,
      PUBLISHING: 5,
      SUCCESS: 6,
      ERROR: 7,
    };

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    let running = !document.hidden;
    const start = performance.now();

    const draw = (now: number) => {
      if (!running) return;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.uniform1f(uState, stateMap[stateRef.current ?? useApp.getState().coreState] ?? 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!reduced) raf = requestAnimationFrame(draw);
    };

    gl.uniform1f(uState, stateMap[stateRef.current ?? useApp.getState().coreState] ?? 0);
    draw(start);
    if (reduced) {
      // draw one static frame reacting to state changes at low rate
      const interval = setInterval(() => draw(performance.now()), 1000);
      return () => {
        clearInterval(interval);
        ro.disconnect();
      };
    }

    const onVis = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else {
        running = true;
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      gl.deleteBuffer(buf);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.deleteProgram(prog);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <div className={`relative overflow-hidden ${className ?? ""}`} aria-hidden="true">
      {/* static fallback under the canvas */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,oklch(0.4_0.12_315/0.5),oklch(0.13_0.012_300)_70%)]" />
      <div className="signal-static-orb"/><canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
