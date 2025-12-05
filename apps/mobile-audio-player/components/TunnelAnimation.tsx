import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { GLView } from 'expo-gl';
import { Renderer } from 'expo-three';
import * as THREE from 'three';

interface TunnelAnimationProps {
    style?: StyleProp<ViewStyle>;
}

export const TunnelAnimation = ({ style }: TunnelAnimationProps) => {
    const onContextCreate = async (gl: any) => {
        const { drawingBufferWidth: width, drawingBufferHeight: height } = gl;
        const renderer = new Renderer({ gl }) as any;
        renderer.setSize(width, height);
        renderer.setClearColor(0x000000, 1);
        renderer.autoClear = false; // Important for trails

        const scene = new THREE.Scene();
        // Use OrthographicCamera to mimic 2D Canvas coordinate system
        const camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 1, 1000);
        camera.position.z = 10;

        // Fade effect plane
        const fadeMaterial = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.04, // Match reference (0.04)
        });
        const fadePlane = new THREE.Mesh(
            new THREE.PlaneGeometry(width * 2, height * 2), // Ensure full coverage
            fadeMaterial
        );
        fadePlane.position.z = -1; // Behind particles
        scene.add(fadePlane);

        // Vignette effect (radial gradient)
        // Reference: radial-gradient(transparent 20%, #111 69%)
        const vignetteMaterial = new THREE.ShaderMaterial({
            uniforms: {
                color: { value: new THREE.Color('#111111') },
            },
            vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
            fragmentShader: `
        uniform vec3 color;
        varying vec2 vUv;
        void main() {
          vec2 center = vec2(0.5, 0.5);
          float dist = distance(vUv, center);
          // 20% start (0.2 radius? No, 20% of box? CSS radial gradient is complex)
          // Let's approximate: transparent at center, fading to color at edges.
          // CSS: transparent 20%, #111 69%
          // smoothstep(0.2, 0.69, dist * 2.0) ? (dist from center 0 to 0.5)
          float alpha = smoothstep(0.2, 0.69, dist * 2.0); 
          gl_FragColor = vec4(color, alpha);
        }
      `,
            transparent: true,
        });
        const vignettePlane = new THREE.Mesh(
            new THREE.PlaneGeometry(width, height),
            vignetteMaterial
        );
        vignettePlane.position.z = 1; // On top of particles
        scene.add(vignettePlane);

        const total = 50;
        const particlesPerRow = 10;
        const particleCount = total * particlesPerRow;
        const maxRadius = Math.max(width, height) / 1.2; // Match w/2 + roughly
        const minRadius = 30;

        // Geometry for segments (quads)
        // Each particle is a quad (2 triangles, 6 vertices if not indexed, or 4 vertices with index)
        // Let's use non-indexed for simplicity in updating: 6 vertices per particle.
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 6 * 3);
        const colors = new Float32Array(particleCount * 6 * 3);

        // Store state for simulation
        const radii = new Float32Array(particleCount);
        const angles = new Float32Array(particleCount);
        const hues = new Float32Array(particleCount);

        const colorPart = 360 / total;
        const radiantPart = (Math.PI * 2) / total;

        let index = 0;
        for (let i = 0; i < total; i++) {
            const angle = radiantPart * i;
            const hue = colorPart * i;
            for (let j = 0; j < particlesPerRow; j++) {
                // Initial distribution
                radii[index] = minRadius + (j / particlesPerRow) * (maxRadius - minRadius);
                angles[index] = angle;
                hues[index] = hue;
                index++;
            }
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.MeshBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 1.0,
            side: THREE.DoubleSide,
        });

        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);

        const render = () => {
            // Update particles and geometry
            let vIndex = 0;
            let cIndex = 0;

            for (let i = 0; i < particleCount; i++) {
                let r = radii[i];
                const oldR = r;
                r -= r / 70; // Move towards center

                if (r <= minRadius && Math.random() < 0.1) {
                    r = maxRadius; // Reset to outside
                }
                radii[i] = r;

                // Define the quad for the segment
                // We want to draw the segment between oldR and r
                // But wait, if r jumps to maxRadius, we shouldn't draw a line across the screen.
                // If reset, draw at maxRadius? Or skip?
                // The original code:
                // ctx.arc(..., particle, ...) // oldR
                // ctx.arc(..., particles[i][j], ...) // newR
                // If it reset, particle (old) is small, particles[i][j] (new) is big.
                // It draws a huge segment?
                // "if (particles[i][j] <= minValue && Math.random() < .1) { particles[i][j] = w / 2; }"
                // This happens AFTER the draw in the original code?
                // No, inside the loop:
                // 1. Update value.
                // 2. Draw.
                // 3. Check reset.
                // So if it resets, it happens AFTER drawing.
                // So the draw is always between oldR and slightly smaller newR.
                // EXCEPT if it reset in the PREVIOUS frame.
                // If it reset previously, r is large. oldR (from state?)
                // In my code, `r` is state.
                // So if I reset `r` to max, next frame `oldR` is max.
                // So it's fine.

                const angleStart = angles[i];
                const angleEnd = angles[i] + radiantPart;

                // Vertices
                // v0: oldR, angleStart
                // v1: oldR, angleEnd
                // v2: r, angleStart
                // v3: r, angleEnd

                // Actually, to avoid gaps, maybe slightly overlap?
                // The original uses arc, which is curved. We use straight lines for quad edges.
                // With 50 segments, it's close enough to a circle.

                const r1 = oldR;
                const r2 = r;

                const x0 = Math.cos(angleStart) * r1;
                const y0 = Math.sin(angleStart) * r1;

                const x1 = Math.cos(angleEnd) * r1;
                const y1 = Math.sin(angleEnd) * r1;

                const x2 = Math.cos(angleStart) * r2;
                const y2 = Math.sin(angleStart) * r2;

                const x3 = Math.cos(angleEnd) * r2;
                const y3 = Math.sin(angleEnd) * r2;

                // Quad (2 triangles): 0-2-1, 1-2-3
                // v0
                positions[vIndex++] = x0; positions[vIndex++] = y0; positions[vIndex++] = 0;
                // v2
                positions[vIndex++] = x2; positions[vIndex++] = y2; positions[vIndex++] = 0;
                // v1
                positions[vIndex++] = x1; positions[vIndex++] = y1; positions[vIndex++] = 0;

                // v1
                positions[vIndex++] = x1; positions[vIndex++] = y1; positions[vIndex++] = 0;
                // v2
                positions[vIndex++] = x2; positions[vIndex++] = y2; positions[vIndex++] = 0;
                // v3
                positions[vIndex++] = x3; positions[vIndex++] = y3; positions[vIndex++] = 0;

                // Colors
                const color = new THREE.Color();
                color.setHSL(hues[i] / 360, 0.8, 0.5);

                for (let k = 0; k < 6; k++) {
                    colors[cIndex++] = color.r;
                    colors[cIndex++] = color.g;
                    colors[cIndex++] = color.b;
                }
            }

            geometry.attributes.position.needsUpdate = true;
            geometry.attributes.color.needsUpdate = true;

            // Global rotation
            // The original rotates the CONTEXT.
            // ctx.translate(w/2, h/2); ctx.rotate(.006);
            // This affects EVERYTHING drawn, including the trails?
            // No, `ctx.rotate` affects the transformation matrix for *new* drawing commands.
            // It does NOT rotate the existing pixels on the canvas.
            // So the trails stay where they were, but the new positions are rotated.
            // Wait, `ctx.fill()` draws the fade rect.
            // `ctx.fillStyle = repaintColor; ctx.fill();` (Draws a circle over the whole canvas).
            // This just dims existing pixels. It doesn't rotate them.

            // So we just rotate the particles container.
            mesh.rotation.z += 0.006;

            // Render
            // We want to keep the previous frame.
            // But we want to dim it.
            // So we render the fade plane (which is black with alpha 0.1).
            // Since `autoClear` is false, this draws ON TOP of the previous frame.
            // Then we draw the points ON TOP of that.

            // To ensure fade plane covers the screen and doesn't move:
            fadePlane.position.x = camera.position.x;
            fadePlane.position.y = camera.position.y;
            // But camera is at 0,0 (ortho center).

            // We need to render the fade plane first?
            // If we just render the scene, Three.js sorts objects.
            // Fade plane is at z=-1. Points at z=0.
            // So Fade plane is drawn BEHIND points.
            // This is correct for the current frame: Background (Fade) -> Points.
            // But we want Fade to be drawn ON TOP of the *previous* frame's buffer.
            // Since we don't clear, the buffer contains [Prev Frame].
            // We draw Fade (z=-1). It blends with [Prev Frame].
            // We draw Points (z=0). They blend with [Fade + Prev Frame].
            // This seems correct.

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
