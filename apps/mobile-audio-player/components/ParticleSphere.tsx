import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { GLView } from 'expo-gl';
import { Renderer } from 'expo-three';
import * as THREE from 'three';

interface ParticleSphereProps {
    style?: StyleProp<ViewStyle>;
}

export const ParticleSphere = ({ style }: ParticleSphereProps) => {
    const onContextCreate = async (gl: any) => {
        const { drawingBufferWidth: width, drawingBufferHeight: height } = gl;
        const renderer = new Renderer({ gl }) as any;
        renderer.setSize(width, height);
        renderer.setClearColor(0x000000, 1);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
        camera.position.z = 110; // Adjusted for mobile view

        const innerColor = 0xff0000;
        const outerColor = 0xff9900;
        const innerSize = 55;
        const outerSize = 60;

        // Lights
        const light = new THREE.AmbientLight(0x404040);
        scene.add(light);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(0, 128, 128);
        scene.add(directionalLight);

        // Sphere Wireframe Inner
        const sphereWireframeInner = new THREE.Mesh(
            new THREE.IcosahedronGeometry(innerSize, 2),
            new THREE.MeshLambertMaterial({
                color: innerColor,
                wireframe: true,
                transparent: true,
                shininess: 0,
            })
        );
        scene.add(sphereWireframeInner);

        // Sphere Wireframe Outer
        const sphereWireframeOuter = new THREE.Mesh(
            new THREE.IcosahedronGeometry(outerSize, 3),
            new THREE.MeshLambertMaterial({
                color: outerColor,
                wireframe: true,
                transparent: true,
                shininess: 0,
            })
        );
        scene.add(sphereWireframeOuter);

        // Sphere Glass Inner
        const sphereGlassInner = new THREE.Mesh(
            new THREE.SphereGeometry(innerSize, 32, 32),
            new THREE.MeshPhongMaterial({
                color: innerColor,
                transparent: true,
                shininess: 25,
                opacity: 0.3,
            })
        );
        scene.add(sphereGlassInner);

        // Sphere Glass Outer
        const sphereGlassOuter = new THREE.Mesh(
            new THREE.SphereGeometry(outerSize, 32, 32),
            new THREE.MeshPhongMaterial({
                color: outerColor,
                transparent: true,
                shininess: 25,
                opacity: 0.3,
            })
        );
        // scene.add(sphereGlassOuter); // Commented out in original script

        // Helper to create particles on sphere surface
        const createSphereParticles = (count: number, size: number, color: number) => {
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(count * 3);

            for (let i = 0; i < count; i++) {
                let x = -1 + Math.random() * 2;
                let y = -1 + Math.random() * 2;
                let z = -1 + Math.random() * 2;
                const d = 1 / Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2) + Math.pow(z, 2));
                x *= d;
                y *= d;
                z *= d;

                positions[i * 3] = x * size;
                positions[i * 3 + 1] = y * size;
                positions[i * 3 + 2] = z * size;
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            return new THREE.Points(
                geometry,
                new THREE.PointsMaterial({
                    size: 0.5, // Adjusted size for mobile
                    color: color,
                    transparent: true,
                })
            );
        };

        // Particles Outer
        const particlesOuter = createSphereParticles(15000, outerSize, outerColor); // Reduced count for mobile
        scene.add(particlesOuter);

        // Particles Inner
        const particlesInner = createSphereParticles(15000, outerSize, innerColor); // Reduced count for mobile
        scene.add(particlesInner);

        // Starfield
        const starGeometry = new THREE.BufferGeometry();
        const starPositions = new Float32Array(2000 * 3); // Reduced count
        for (let i = 0; i < 2000; i++) {
            starPositions[i * 3] = Math.random() * 2000 - 1000;
            starPositions[i * 3 + 1] = Math.random() * 2000 - 1000;
            starPositions[i * 3 + 2] = Math.random() * 2000 - 1000;
        }
        starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
        const starField = new THREE.Points(
            starGeometry,
            new THREE.PointsMaterial({
                size: 2,
                color: 0xffff99,
            })
        );
        scene.add(starField);

        const clock = new THREE.Clock();

        const render = () => {
            const elapsedTime = clock.getElapsedTime();

            sphereWireframeInner.rotation.x += 0.002;
            sphereWireframeInner.rotation.z += 0.002;

            sphereWireframeOuter.rotation.x += 0.001;
            sphereWireframeOuter.rotation.z += 0.001;

            sphereGlassInner.rotation.y += 0.005;
            sphereGlassInner.rotation.z += 0.005;

            sphereGlassOuter.rotation.y += 0.01;
            sphereGlassOuter.rotation.z += 0.01;

            particlesOuter.rotation.y += 0.0005;
            particlesInner.rotation.y -= 0.002;

            starField.rotation.y -= 0.002;

            const innerShift = Math.abs(Math.cos((elapsedTime + 2.5) / 20));
            const outerShift = Math.abs(Math.cos((elapsedTime + 5) / 10));

            (starField.material as THREE.PointsMaterial).color.setHSL(Math.abs(Math.cos(elapsedTime / 10)), 1, 0.5);

            (sphereWireframeOuter.material as THREE.MeshLambertMaterial).color.setHSL(0, 1, outerShift);
            (sphereGlassOuter.material as THREE.MeshPhongMaterial).color.setHSL(0, 1, outerShift);
            (particlesOuter.material as THREE.PointsMaterial).color.setHSL(0, 1, outerShift);

            (sphereWireframeInner.material as THREE.MeshLambertMaterial).color.setHSL(0.08, 1, innerShift);
            (particlesInner.material as THREE.PointsMaterial).color.setHSL(0.08, 1, innerShift);
            (sphereGlassInner.material as THREE.MeshPhongMaterial).color.setHSL(0.08, 1, innerShift);

            (sphereWireframeInner.material as THREE.MeshLambertMaterial).opacity = Math.abs(Math.cos((elapsedTime + 0.5) / 0.9) * 0.5);
            (sphereWireframeOuter.material as THREE.MeshLambertMaterial).opacity = Math.abs(Math.cos(elapsedTime / 0.9) * 0.5);

            directionalLight.position.x = Math.cos(elapsedTime / 0.5) * 128;
            directionalLight.position.y = Math.cos(elapsedTime / 0.5) * 128;
            directionalLight.position.z = Math.sin(elapsedTime / 0.5) * 128;

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
