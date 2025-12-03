import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { GLView } from 'expo-gl';
import { Renderer } from 'expo-three';
import * as THREE from 'three';

interface Galaxy3DProps {
  style?: StyleProp<ViewStyle>;
}

export const Galaxy3D = ({ style }: Galaxy3DProps) => {
  const onContextCreate = async (gl: any) => {
    const { drawingBufferWidth: width, drawingBufferHeight: height } = gl;
    const renderer = new Renderer({ gl }) as any;
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 1); // Black background

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
    camera.position.set(0, 2, 3);
    camera.lookAt(0, 0, 0);

    // --- Shader Utils ---
    const shaderUtils = `
      float random (vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
      }

      vec3 scatter (vec3 seed) {
        float u = random(seed.xy);
        float v = random(seed.yz);
        float theta = u * 6.28318530718;
        float phi = acos(2.0 * v - 1.0);

        float sinTheta = sin(theta);
        float cosTheta = cos(theta);
        float sinPhi = sin(phi);
        float cosPhi = cos(phi);

        float x = sinPhi * cosTheta;
        float y = sinPhi * sinTheta;
        float z = cosPhi;

        return vec3(x, y, z);
      }
    `;

    // --- Galaxy ---
    const count = 2000; // Increased count for full screen density
    const galaxyGeometry = new THREE.BufferGeometry();
    const galaxyPosition = new Float32Array(count * 3);
    const galaxySeed = new Float32Array(count * 3);
    const galaxySize = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      galaxyPosition[i * 3] = i / count;
      galaxySeed[i * 3 + 0] = Math.random();
      galaxySeed[i * 3 + 1] = Math.random();
      galaxySeed[i * 3 + 2] = Math.random();
      galaxySize[i] = Math.random() * 2 + 0.5;
    }

    galaxyGeometry.setAttribute('position', new THREE.BufferAttribute(galaxyPosition, 3));
    galaxyGeometry.setAttribute('size', new THREE.BufferAttribute(galaxySize, 1));
    galaxyGeometry.setAttribute('seed', new THREE.BufferAttribute(galaxySeed, 3));

    const galaxyMaterial = new THREE.RawShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 2.0 }, // Hardcoded size to ensure visibility
        uBranches: { value: 2 },
        uRadius: { value: 1.618 }, // Set initial values directly
        uSpin: { value: Math.PI * 2 },
        uRandomness: { value: 0.5 },
        uColorInn: { value: new THREE.Color('#f40') },
        uColorOut: { value: new THREE.Color('#a7f') },
      },
      vertexShader: `
        precision highp float;
        attribute vec3 position;
        attribute float size;
        attribute vec3 seed;
        uniform mat4 projectionMatrix;
        uniform mat4 modelViewMatrix;
        uniform float uTime;
        uniform float uSize;
        uniform float uBranches;
        uniform float uRadius;
        uniform float uSpin;
        uniform float uRandomness;
        varying float vDistance;
        #define PI  3.14159265359
        #define PI2 6.28318530718
        ${shaderUtils}

        void main() {
          vec3 p = position;
          float st = sqrt(p.x);
          float qt = p.x * p.x;
          float mt = mix(st, qt, p.x);

          float angle = qt * uSpin * (2.0 - sqrt(1.0 - qt));
          float branchOffset = (PI2 / uBranches) * floor(seed.x * uBranches);
          p.x = position.x * cos(angle + branchOffset) * uRadius;
          p.z = position.x * sin(angle + branchOffset) * uRadius;

          p += scatter(seed) * random(seed.zx) * uRandomness * mt;
          p.y *= 0.5 + qt * 0.5;

          vec3 temp = p;
          float ac = cos(-uTime * (2.0 - st) * 0.5);
          float as = sin(-uTime * (2.0 - st) * 0.5);
          p.x = temp.x * ac - temp.z * as;
          p.z = temp.x * as + temp.z * ac;

          vDistance = mt;
          vec4 mvp = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvp;
          gl_PointSize = (10.0 * size * uSize) / -mvp.z;
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform vec3 uColorInn;
        uniform vec3 uColorOut;
        varying float vDistance;
        #define PI  3.14159265359

        void main() {
          // Procedural Alpha Map
          vec2 uv = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y);
          vec2 center = vec2(0.5, 0.5);
          float d = distance(uv, center);
          float a = 0.0;
          
          // Simple soft circle
          if (d < 0.5) {
             a = 1.0 - smoothstep(0.0, 0.5, d);
             // Make it sharper like the original texture
             a = pow(a, 3.0); 
          }
          
          if (a < 0.1) discard;

          vec3 color = mix(uColorInn, uColorOut, vDistance);
          float c = step(0.99, (sin(gl_PointCoord.x * PI) + sin(gl_PointCoord.y * PI)) * 0.5);
          color = max(color, vec3(c));

          gl_FragColor = vec4(color, a);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const galaxy = new THREE.Points(galaxyGeometry, galaxyMaterial);
    scene.add(galaxy);

    // --- Universe ---
    const universeGeometry = new THREE.BufferGeometry();
    const universePosition = new Float32Array(count * 3 / 2);
    const universeSeed = new Float32Array(count * 3 / 2);
    const universeSize = new Float32Array(count / 2);

    for (let i = 0; i < count / 2; i++) {
      universeSeed[i * 3 + 0] = Math.random();
      universeSeed[i * 3 + 1] = Math.random();
      universeSeed[i * 3 + 2] = Math.random();
      universeSize[i] = Math.random() * 2 + 0.5;
    }

    universeGeometry.setAttribute('position', new THREE.BufferAttribute(universePosition, 3));
    universeGeometry.setAttribute('seed', new THREE.BufferAttribute(universeSeed, 3));
    universeGeometry.setAttribute('size', new THREE.BufferAttribute(universeSize, 1));

    const universeMaterial = new THREE.RawShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSize: galaxyMaterial.uniforms.uSize,
        uRadius: galaxyMaterial.uniforms.uRadius,
      },
      vertexShader: `
        precision highp float;
        attribute vec3 seed;
        attribute float size;
        uniform mat4 projectionMatrix;
        uniform mat4 modelViewMatrix;
        uniform float uTime;
        uniform float uSize;
        uniform float uRadius;
        #define PI  3.14159265359
        #define PI2 6.28318530718
        ${shaderUtils}

        const float r = 3.0;
        const vec3 s = vec3(2.1, 1.3, 2.1);

        void main() {
          vec3 p = scatter(seed) * r * s;
          float q = random(seed.zx);
          for (int i = 0; i < 3; i++) q *= q;
          p *= q;

          float l = length(p) / (s.x * r);
          p = l < 0.001 ? (p / l) : p;

          vec3 temp = p;
          float ql = 1.0 - l;
          for (int i = 0; i < 3; i++) ql *= ql;
          float ac = cos(-uTime * ql);
          float as = sin(-uTime * ql);
          p.x = temp.x * ac - temp.z * as;
          p.z = temp.x * as + temp.z * ac;

          vec4 mvp = modelViewMatrix * vec4(p * uRadius, 1.0);
          gl_Position = projectionMatrix * mvp;

          l = (2.0 - l) * (2.0 - l);
          gl_PointSize = (r * size * uSize * l) / -mvp.z;
        }
      `,
      fragmentShader: `
        precision highp float;
        #define PI 3.14159265359

        void main() {
          vec2 uv = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y);
          vec2 center = vec2(0.5, 0.5);
          float d = distance(uv, center);
          float a = 0.0;
          if (d < 0.5) {
             a = 1.0 - smoothstep(0.0, 0.5, d);
             a = pow(a, 3.0);
          }
          if (a < 0.1) discard;
          gl_FragColor = vec4(vec3(1.0), a);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const universe = new THREE.Points(universeGeometry, universeMaterial);
    scene.add(universe);

    // --- Animation Loop ---
    const t = 0.01;
    const render = () => {
      requestAnimationFrame(render);
      galaxyMaterial.uniforms.uTime.value += t / 2;
      universeMaterial.uniforms.uTime.value += t / 3;

      // Rotate the whole galaxy group slightly if needed, or just let shaders handle it
      galaxy.rotation.y += 0.001;
      universe.rotation.y += 0.0003;

      renderer.render(scene, camera);
      gl.endFrameEXP();
    };
    render();
  };

  return (
    <View style={[styles.container, style]}>
      <GLView style={styles.glView} onContextCreate={onContextCreate} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  glView: {
    width: '100%',
    height: '100%',
  },
});
