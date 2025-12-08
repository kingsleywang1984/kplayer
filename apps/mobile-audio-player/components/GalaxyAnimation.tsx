import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
    Easing,
    withDelay,
    withSequence,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

const NUM_PARTICLES = 500; // Significantly increased density
const ARMS = 2; // Classic 2-arm spiral
const ARM_X_DIST = 120; // Spread of the arms

type Particle = {
    id: number;
    x: number;
    y: number;
    size: number;
    color: string;
    delay: number;
    duration: number;
    initialOpacity: number;
};

const generateGalaxyParticles = (): Particle[] => {
    const particles: Particle[] = [];

    // Color palettes based on distance
    const coreColors = ['#FFFFFF', '#FFFACD', '#FFD700']; // White, LemonChiffon, Gold
    const midColors = ['#00FFFF', '#87CEEB', '#4169E1']; // Cyan, SkyBlue, RoyalBlue
    const outerColors = ['#DA70D6', '#BA55D3', '#9370DB', '#8A2BE2']; // Orchid, MediumOrchid, MediumPurple, BlueViolet

    for (let i = 0; i < NUM_PARTICLES; i++) {
        // Logarithmic Spiral Formula
        // r = a * e^(b * theta)
        // We approximate this by relating angle to index

        const armIndex = i % ARMS;
        const particleIndexInArm = Math.floor(i / ARMS);
        const particlesPerArm = NUM_PARTICLES / ARMS;

        // Progress along the arm (0 to 1)
        const t = particleIndexInArm / particlesPerArm;

        // Angle: Rotate based on progress + arm offset
        // 4 * PI means 2 full rotations
        const angle = t * Math.PI * 4 + (armIndex * (Math.PI * 2 / ARMS));

        // Radius: Exponential growth
        // Use a power function for distribution
        const radius = Math.pow(t, 0.8) * ARM_X_DIST;

        // Randomness (Dust spread)
        // Spread increases with radius
        const spread = 5 + (radius * 0.2);
        const randomOffsetX = (Math.random() - 0.5) * spread;
        const randomOffsetY = (Math.random() - 0.5) * spread;

        const x = (radius * Math.cos(angle)) + randomOffsetX;
        const y = (radius * Math.sin(angle)) + randomOffsetY;

        // Determine color based on radius
        let color;
        if (radius < 30) {
            color = coreColors[Math.floor(Math.random() * coreColors.length)];
        } else if (radius < 80) {
            color = midColors[Math.floor(Math.random() * midColors.length)];
        } else {
            color = outerColors[Math.floor(Math.random() * outerColors.length)];
        }

        // Size: Center stars are slightly larger
        const baseSize = radius < 40 ? 2.5 : 1.5;
        const size = Math.random() * baseSize + 0.5;

        // Twinkle animation params
        const delay = Math.random() * 3000;
        const duration = Math.random() * 2000 + 1500;
        const initialOpacity = Math.random() * 0.5 + 0.3;

        particles.push({ id: i, x, y, size, color, delay, duration, initialOpacity });
    }
    return particles;
};

const Star = ({ particle }: { particle: Particle }) => {
    const opacity = useSharedValue(particle.initialOpacity);

    useEffect(() => {
        opacity.value = withDelay(
            particle.delay,
            withRepeat(
                withSequence(
                    withTiming(1, { duration: particle.duration / 2 }),
                    withTiming(particle.initialOpacity, { duration: particle.duration / 2 })
                ),
                -1,
                true
            )
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps -- Animation values are stable refs, particle props are stable
    }, []);

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
    }));

    return (
        <Animated.View
            style={[
                styles.star,
                {
                    left: particle.x,
                    top: particle.y,
                    width: particle.size,
                    height: particle.size,
                    backgroundColor: particle.color,
                    shadowColor: particle.color,
                    shadowRadius: particle.size, // Reduced shadow radius for performance with high count
                    shadowOpacity: 0.6,
                },
                animatedStyle,
            ]}
        />
    );
};

export const GalaxyAnimation = () => {
    const rotation = useSharedValue(0);
    const particles = useMemo(() => generateGalaxyParticles(), []);

    useEffect(() => {
        rotation.value = withRepeat(
            withTiming(360, {
                duration: 40000, // Even slower for majesty
                easing: Easing.linear,
            }),
            -1
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps -- rotation is a stable ref
    }, []);

    const animatedStyle = useAnimatedStyle(() => {
        return {
            transform: [
                { perspective: 800 }, // Deeper perspective
                { rotateX: '65deg' }, // Stronger tilt
                { rotateZ: `${rotation.value}deg` },
            ],
        };
    });

    return (
        <View style={styles.container}>
            <Animated.View style={[styles.galaxyContainer, animatedStyle]}>
                {/* Intense Glowing Core */}
                <View style={styles.coreContainer}>
                    <LinearGradient
                        colors={['rgba(255, 255, 255, 1)', 'rgba(255, 220, 150, 0.8)', 'rgba(255, 200, 50, 0.3)', 'transparent']}
                        locations={[0, 0.3, 0.6, 1]}
                        style={styles.core}
                    />
                </View>

                {/* Particles */}
                {particles.map((p) => (
                    <Star key={p.id} particle={p} />
                ))}
            </Animated.View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        width: 280,
        height: 280,
        justifyContent: 'center',
        alignItems: 'center',
    },
    galaxyContainer: {
        width: 200,
        height: 200,
        justifyContent: 'center',
        alignItems: 'center',
    },
    coreContainer: {
        position: 'absolute',
        width: 80, // Larger core container
        height: 80,
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 20, // Ensure core is on top
    },
    core: {
        width: 80,
        height: 80,
        borderRadius: 40,
    },
    star: {
        position: 'absolute',
        borderRadius: 50,
    },
});
