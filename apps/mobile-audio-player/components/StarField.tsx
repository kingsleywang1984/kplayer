import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View, Dimensions } from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withRepeat,
    withTiming,
    withDelay,
    Easing,
} from 'react-native-reanimated';

const { width, height } = Dimensions.get('window');
const NUM_STARS = 100;

type StarProps = {
    x: number;
    y: number;
    size: number;
    delay: number;
    duration: number;
};

const Star: React.FC<StarProps> = ({ x, y, size, delay, duration }) => {
    const opacity = useSharedValue(0.2);

    const style = useAnimatedStyle(() => {
        return {
            opacity: opacity.value,
            transform: [{ scale: opacity.value }], // Optional: scale with opacity for more depth
        };
    });

    useEffect(() => {
        opacity.value = withDelay(
            delay,
            withRepeat(
                withTiming(1, { duration, easing: Easing.inOut(Easing.quad) }),
                -1,
                true // reverse
            )
        );
    }, [delay, duration]);

    return (
        <Animated.View
            style={[
                styles.star,
                {
                    left: x,
                    top: y,
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                },
                style,
            ]}
        />
    );
};

export const StarField: React.FC = () => {
    const stars = useMemo(() => {
        return Array.from({ length: NUM_STARS }).map((_, i) => ({
            id: i,
            x: Math.random() * width,
            y: Math.random() * height,
            size: Math.random() * 2 + 1, // 1 to 3
            delay: Math.random() * 2000,
            duration: Math.random() * 3000 + 2000, // 2s to 5s
        }));
    }, []);

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {stars.map((star) => (
                <Star
                    key={star.id}
                    x={star.x}
                    y={star.y}
                    size={star.size}
                    delay={star.delay}
                    duration={star.duration}
                />
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    star: {
        position: 'absolute',
        backgroundColor: 'white',
    },
});
