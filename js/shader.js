export function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Greška u shaderu:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

export function createShaderProgram(gl, vsSource, fsSource) {
  function compile(src, type) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);

    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error("❌ Shader compile error:", gl.getShaderInfoLog(sh));
      console.log("Source:\n" + src); // <<< ispisi ceo shader koji puca
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  const vs = compile(vsSource, gl.VERTEX_SHADER);
  const fs = compile(fsSource, gl.FRAGMENT_SHADER);

  if (!vs || !fs) {
    console.error("❌ Shader nije uspeo da se kompajlira");
    return null;
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error("❌ Program link error:", gl.getProgramInfoLog(prog));
    return null;
  }

  return prog;
}
