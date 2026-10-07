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
uniform float u_state;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
void main(){
 vec2 p=(gl_FragCoord.xy-.5*u_res)/min(u_res.x,u_res.y);
 float r=length(p),radius=.365;
 float active=step(.5,u_state),speed=mix(.025,.055,active);
 vec3 cyan=vec3(.08,.66,1.0),violet=vec3(.58,.22,1.0);
 if(u_state>6.5){cyan=vec3(.65,.12,.14);violet=vec3(.45,.13,.22);}
 float edge=abs(r-radius);
 float atmosphere=exp(-edge*85.0)*.62 + exp(-edge*24.0)*.12;
 vec3 tint=mix(cyan,violet,smoothstep(-.22,.25,p.x));
 vec3 color=tint*atmosphere;
 if(r<radius){
  vec2 q=p/radius;
  float z=sqrt(max(0.0,1.0-dot(q,q)));
  vec3 normal=vec3(q,z);
  float diffuse=max(0.0,dot(normal,normalize(vec3(-.55,.7,.75))));
  float rim=pow(1.0-z,2.4);
  vec2 surface=vec2(atan(normal.x,normal.z)+u_time*speed,asin(clamp(normal.y,-1.0,1.0)));
  float clouds=noise(surface*8.0)*.65+noise(surface*21.0)*.35;
  color=vec3(.012,.027,.075)+vec3(.025,.105,.25)*diffuse;
  color+=cyan*pow(diffuse,4.0)*.21 + tint*rim*.8;
  color+=vec3(.055,.10,.22)*clouds*diffuse;
  vec2 cell=floor(surface*90.0),f=fract(surface*90.0)-.5;
  float star=step(.982,hash(cell))*(1.0-smoothstep(.02,.16,length(f)));
  color+=vec3(.40,.65,1.0)*star*(.7+.3*sin(u_time*.4+hash(cell)*6.28));
  float purpleLight=pow(max(0.0,dot(normal,normalize(vec3(.9,.3,.2)))),8.0);
  color+=violet*purpleLight*.62;
  float northLight=pow(max(0.0,dot(normal,normalize(vec3(-.2,.9,.2)))),14.0);
  color+=vec3(.25,.65,1.0)*northLight*.6;
 }
 float alpha=1.0-smoothstep(radius+.025,radius+.12,r);
 gl_FragColor=vec4(color,alpha);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { gl.deleteShader(sh); return null; }
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
    const gl = canvas.getContext("webgl", { antialias: false, alpha: true, powerPreference: "low-power" });
    if (!gl) return; // graceful degradation: parent shows static gradient

    const prog = gl.createProgram()!;
    const vertex = compile(gl, gl.VERTEX_SHADER, VERT);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vertex || !fragment) { if (vertex) gl.deleteShader(vertex); if (fragment) gl.deleteShader(fragment); gl.deleteProgram(prog); return; }
    gl.attachShader(prog, vertex);
    gl.attachShader(prog, fragment);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { gl.deleteShader(vertex); gl.deleteShader(fragment); gl.deleteProgram(prog); return; }
    canvas.classList.add("signal-gl-ready");
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
      canvas.classList.remove("signal-gl-ready");
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

      <div className="signal-static-orb"/><canvas ref={canvasRef} className="signal-gl-canvas absolute inset-0 h-full w-full" />
    </div>
  );
}
