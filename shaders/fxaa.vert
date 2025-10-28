#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;

out vec2 vUV;
out vec2 sampleCoordS;
out vec2 sampleCoordE;
out vec2 sampleCoordN;
out vec2 sampleCoordW;
out vec2 sampleCoordNW;
out vec2 sampleCoordSE;
out vec2 sampleCoordNE;
out vec2 sampleCoordSW;

uniform vec2 uTexelSize; // 1.0 / resolution

void main() {
    vUV = aUV;

    sampleCoordS  = vUV + vec2( 0.0,  uTexelSize.y);
    sampleCoordE  = vUV + vec2( uTexelSize.x,  0.0);
    sampleCoordN  = vUV + vec2( 0.0, -uTexelSize.y);
    sampleCoordW  = vUV + vec2(-uTexelSize.x,  0.0);

    sampleCoordNW = vUV + vec2(-uTexelSize.x, -uTexelSize.y);
    sampleCoordNE = vUV + vec2( uTexelSize.x, -uTexelSize.y);
    sampleCoordSW = vUV + vec2(-uTexelSize.x,  uTexelSize.y);
    sampleCoordSE = vUV + vec2( uTexelSize.x,  uTexelSize.y);

    gl_Position = vec4(aPos, 1.0);
}
