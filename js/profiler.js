// GPU PROFILER za WebGL2
// Koristi EXT_disjoint_timer_query za merenje GPU vremena po shader pass-u

export class GpuProfiler {
  constructor(gl) {
    this.gl = gl;
    this.ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    if (!this.ext) throw new Error("EXT_disjoint_timer_query_webgl2 not supported");
    this.entries = [];
    this.queries = [];
  }

  begin(label) {
    const gl = this.gl;
    const q = gl.createQuery();
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.queries.push({ label, query: q });
  }

  end() {
    const gl = this.gl;
    gl.endQuery(this.ext.TIME_ELAPSED_EXT);
  }

  resolveResults() {
    const gl = this.gl;
    const ext = this.ext;
    const done = [];
    for (let i = 0; i < this.queries.length; i++) {
      const { label, query } = this.queries[i];
      const available = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE);
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      if (available && !disjoint) {
        const timeElapsed = gl.getQueryParameter(query, gl.QUERY_RESULT); // in ns
        this.entries.push({ label, ms: timeElapsed / 1e6 });
        done.push(i);
      }
    }
    for (let i = done.length - 1; i >= 0; i--) {
      this.queries.splice(done[i], 1);
    }
  }

  log() {
    this.entries.forEach(e => {
      console.log(`GPU: ${e.label} = ${e.ms.toFixed(2)}ms`);
    });
    this.entries = [];
  }
}

// === Upotreba ===
// import { GpuProfiler } from './profiler.js';
// const profiler = new GpuProfiler(gl);
// profiler.begin("ssao");
// drawSSAO();
// profiler.end();
// profiler.resolveResults();
// profiler.log();
