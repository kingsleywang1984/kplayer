import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { GLView } from 'expo-gl';
import { Renderer, TextureLoader } from 'expo-three';
import * as THREE from 'three';
import { Asset } from 'expo-asset';

interface WormholeProps {
  style?: StyleProp<ViewStyle>;
}

export const Wormhole = ({ style }: WormholeProps) => {
  const onContextCreate = async (gl: any) => {
    const { drawingBufferWidth: width, drawingBufferHeight: height } = gl;
    const renderer = new Renderer({ gl }) as any;
    renderer.setSize(width, height);
    renderer.setPixelRatio(1); // Use 1 for performance on mobile

    const scene = new THREE.Scene();
    const camera = new THREE.Camera();
    camera.position.z = 1;

    const geometry = new THREE.PlaneGeometry(2, 2);

    // Load local asset
    const asset = Asset.fromModule(require('../assets/noise.png'));
    await asset.downloadAsync();

    const textureLoader = new TextureLoader();
    const noiseTexture = textureLoader.load(asset.uri);
    noiseTexture.wrapS = THREE.RepeatWrapping;
    noiseTexture.wrapT = THREE.RepeatWrapping;
    noiseTexture.minFilter = THREE.LinearFilter;

    // Ensure texture is updated
    noiseTexture.needsUpdate = true;

    const uniforms = {
      u_time: { value: 1.0 },
      u_resolution: { value: new THREE.Vector2(width, height) },
      u_noise: { value: noiseTexture },
      u_mouse: { value: new THREE.Vector2() },
    };

    const vertexShader = `
      void main() {
        gl_Position = vec4( position, 1.0 );
      }
    `;

    const fragmentShader = `
      uniform vec2 u_resolution;
      uniform vec2 u_mouse;
      uniform float u_time;
      uniform sampler2D u_noise;

      #define PI 3.141592653589793
      #define TAU 6.283185307179586

      const int octaves = 2;
      const float seed = 43758.5453123;
      const float seed2 = 73156.8473192;

      float r1 = 0.2;
      float r2 = 0.9;

      vec2 cCis(float r);
      vec2 cLog(vec2 c);
      vec2 cInv(vec2 c);
      float cArg(vec2 c);
      float cAbs(vec2 c);

      vec2 cMul(vec2 a, vec2 b);
      vec2 cDiv(vec2 a, vec2 b);

      vec2 cCis(float r) {
        return vec2( cos(r), sin(r) );
      }
      vec2 cExp(vec2 c) {
        return exp(c.x) * cCis(c.y);
      }
      vec2 cConj(vec2 c) {
        return vec2(c.x, -c.y);
      }
      vec2 cInv(vec2 c) {
        return cConj(c) / dot(c, c);
      }
      vec2 cLog(vec2 c) {
        return vec2( log( cAbs(c) ), cArg(c) );
      }
      float cArg(vec2 c) {
        return atan(c.y, c.x);
      }
      float cAbs(vec2 c) {
        return length(c);
      }
      vec2 cMul(vec2 a, vec2 b) {
        return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x);
      }
      vec2 cDiv(vec2 a, vec2 b) {
        return cMul(a, cInv(b));
      }

      float noiseLUT( in vec3 x ) {
        vec3 p = floor(x);
        vec3 f = fract(x);
        f = f*f*(3.0-2.0*f);
        vec2 uv = (p.xy+vec2(37.0,17.0)*p.z) + f.xy;
        vec2 rg = texture2D(u_noise, (uv+0.5)/256.0).yx - .5;
        return mix( rg.x, rg.y, f.z );
      }

      float fbm1(in vec2 _st, float seed) {
        float v = 0.0;
        float a = 0.5;
        vec2 shift = vec2(100.0);
        mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.50));
        for (int i = 0; i < octaves; ++i) {
          v += a * noiseLUT(vec3(_st, 1.));
          _st = rot * _st * 2.0 + shift;
          a *= 0.4;
        }
        return v;
      }

      float pattern(vec2 uv, float seed, float time, inout vec2 q, inout vec2 r) {
        q = vec2( fbm1( uv + vec2(0.0,0.0), seed ),
                  fbm1( uv + vec2(5.2,1.3), seed ) );

        r = vec2( fbm1( uv + 4.0*q + vec2(1.7 - time / 2.,9.2), seed ),
                  fbm1( uv + 4.0*q + vec2(8.3 - time / 2.,2.8), seed ) );

        return fbm1( uv + 4.0*r, seed );
      }

      vec3 hsb2rgb( in vec3 c ){
        vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0), 6.0)-3.0)-1.0, 0.0, 1.0 );
        rgb = rgb*rgb*(3.0-2.0*rgb);
        return c.z * mix( vec3(1.0), rgb, c.y);
      }

      vec2 Droste(vec2 uv) {
        uv = cLog(uv);
        float scale = log(r2/r1);
        float angle = atan(scale/(2.0*PI));
        uv = cDiv(uv, cExp(vec2(0,angle))*cos(angle));
        uv -= u_time * .2;
        uv.x = mod(uv.x,log(r2/r1));
        uv = cExp(uv)*r1;
        return uv;
      }

      void main() {
        vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.y, u_resolution.x);
        uv *= 2.;
        vec2 _uv = uv;
        vec2 polar = vec2(length(_uv), atan(uv.y, uv.x));

        uv = Droste(uv);

        float rInv = 1./length(uv);
        uv = uv * rInv - vec2(rInv, 1.);

        vec2 p;
        vec2 q;
        float pat = pattern(uv * 5., seed, u_time * 5., p, q);

        vec3 fragcolour = mix(
          mix(
            vec3(.9, .7, 0.),
            vec3(1., .55, 0.1),
            abs(q.x*p.y)*20.),
          vec3(.5, .3, 0.),
          pat
        );
        fragcolour -= smoothstep(-.1, .9, p.x) * .5;
        fragcolour += smoothstep(-.1, .5, p.y) * .5;

        fragcolour += (1. - length(_uv * 2.)) *.5 ;
        float lcol = clamp(length((_uv) * 4.) - .2, 0., 1.);

        float raynoise = fbm1(polar*10.-u_time*2., seed);

        fragcolour = mix(
          fragcolour,
          vec3(sin(p.y * 10.), cos(q.y * 10.), pat * 2.) * .5 + 1.5,
          clamp(
            abs(sin(polar.y * 50.)) * 1. / length(_uv * _uv * 3.) * raynoise - .2,
            0.,
            1.) * .2);

        fragcolour = mix(vec3(1.), fragcolour, lcol);

        gl_FragColor = vec4(fragcolour,1.0);
      }
    `;

    const material = new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
    });
    material.extensions.derivatives = true;

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const clock = new THREE.Clock();

    const render = () => {
      const delta = clock.getDelta();
      // Match the original script's time scale
      // uniforms.u_time.value = -11000 + delta * 0.0005; 
      // The original script likely uses a global timer or timestamp.
      // Let's use elapsed time with a similar scale factor if needed, or just increment.
      // The original uses `delta` which is usually time since last frame (e.g. 16ms).
      // 16 * 0.0005 = 0.008 per frame.
      // Let's try incrementing by delta * 0.5 to match visual speed.

      uniforms.u_time.value += delta * 0.5;

      renderer.render(scene, camera);
      gl.endFrameEXP();
      requestAnimationFrame(render);
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
    backgroundColor: 'black',
  },
  glView: {
    width: '100%',
    height: '100%',
  },
});
