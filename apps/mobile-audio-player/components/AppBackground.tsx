import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Galaxy3D } from '@/components/Galaxy3D';
import { RainbowZappers } from '@/components/RainbowZappers';
import { ParticleSphere } from '@/components/ParticleSphere';
import { useSettings } from '@/context/settings-context';

interface AppBackgroundProps {
    style?: StyleProp<ViewStyle>;
}

export function AppBackground({ style }: AppBackgroundProps) {
    const { backgroundMode } = useSettings();

    if (backgroundMode === 'galaxy') {
        return <Galaxy3D style={style} />;
    }

    if (backgroundMode === 'rainbow_zappers') {
        return <RainbowZappers style={style} />;
    }

    if (backgroundMode === 'particle_sphere') {
        return <ParticleSphere style={style} />;
    }

    return <View style={[styles.container, style]} />;
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: 'black',
    },
});
