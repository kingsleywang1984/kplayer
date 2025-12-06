
import React, { useState, useMemo } from 'react';
import { View, ScrollView, StyleSheet, FlatList } from 'react-native';
import { Modal, Portal, Text, Button, IconButton, useTheme, Card, Divider, FAB } from 'react-native-paper';
import { BlurView } from 'expo-blur';
import { TextColors, SurfaceColors, BorderColors, Spacing, BorderRadius } from '@/constants/theme';

type TrackMetadata = {
    videoId: string;
    title: string;
    author?: string;
    durationSeconds?: number | null;
    thumbnailUrl?: string | null;
};

type GroupMetadata = {
    id: string;
    name: string;
    trackIds: string[];
};

type GroupDetailModalProps = {
    visible: boolean;
    onDismiss: () => void;
    group: GroupMetadata | null;
    allTracks: TrackMetadata[];
    onUpdateGroup: (groupId: string, name: string, trackIds: string[]) => Promise<void>;
    onPlayGroup: (groupId: string) => void;
};

export function GroupDetailModal({
    visible,
    onDismiss,
    group,
    allTracks,
    onUpdateGroup,
    onPlayGroup,
}: GroupDetailModalProps) {
    const theme = useTheme();
    const [isAddingMode, setIsAddingMode] = useState(false);

    const groupTracks = useMemo(() => {
        if (!group) return [];
        return group.trackIds
            .map((id) => allTracks.find((t) => t.videoId === id))
            .filter((t): t is TrackMetadata => !!t);
    }, [group, allTracks]);

    const availableTracks = useMemo(() => {
        if (!group) return [];
        return allTracks.filter((t) => !group.trackIds.includes(t.videoId));
    }, [group, allTracks]);

    const handleRemoveTrack = async (videoId: string) => {
        if (!group) return;
        const newTrackIds = group.trackIds.filter((id) => id !== videoId);
        await onUpdateGroup(group.id, group.name, newTrackIds);
    };

    const handleAddTrack = async (videoId: string) => {
        if (!group) return;
        const newTrackIds = [...group.trackIds, videoId];
        await onUpdateGroup(group.id, group.name, newTrackIds);
    };

    if (!group) return null;

    return (
        <Portal>
            <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.modalContainer}>
                <BlurView intensity={40} tint="dark" style={styles.blurContainer}>
                    <View style={styles.header}>
                        <View>
                            <Text variant="headlineSmall" style={{ color: TextColors.primary }}>{group.name}</Text>
                            <Text variant="bodySmall" style={{ color: theme.colors.outline }}>
                                {group.trackIds.length} tracks
                            </Text>
                        </View>
                        <View style={styles.headerActions}>
                            <IconButton icon="play-circle" iconColor={theme.colors.primary} size={30} onPress={() => onPlayGroup(group.id)} />
                            <IconButton icon="close" iconColor="white" onPress={onDismiss} />
                        </View>
                    </View>

                    <Divider style={styles.divider} />

                    {isAddingMode ? (
                        <View style={styles.content}>
                            <View style={styles.subHeader}>
                                <Text variant="titleMedium" style={{ color: TextColors.primary }}>Add Songs</Text>
                                <Button mode="text" onPress={() => setIsAddingMode(false)}>Done</Button>
                            </View>
                            {availableTracks.length === 0 ? (
                                <View style={styles.emptyState}>
                                    <Text variant="bodyMedium" style={{ color: TextColors.tertiary }}>No more tracks to add.</Text>
                                </View>
                            ) : (
                                <FlatList
                                    data={availableTracks}
                                    keyExtractor={(item) => item.videoId}
                                    renderItem={({ item }) => (
                                        <Card style={styles.trackCard} mode="contained">
                                            <Card.Content style={styles.cardContent}>
                                                <View style={styles.trackInfo}>
                                                    <Text variant="bodyLarge" numberOfLines={1} style={{ color: TextColors.primary }}>{item.title}</Text>
                                                    <Text variant="bodySmall" style={{ color: TextColors.muted }}>{item.author}</Text>
                                                </View>
                                                <IconButton
                                                    icon="plus"
                                                    iconColor={theme.colors.primary}
                                                    onPress={() => handleAddTrack(item.videoId)}
                                                />
                                            </Card.Content>
                                        </Card>
                                    )}
                                />
                            )}
                        </View>
                    ) : (
                        <View style={styles.content}>
                            <View style={styles.subHeader}>
                                <Button mode="contained-tonal" icon="plus" onPress={() => setIsAddingMode(true)} style={{ marginBottom: 10 }}>
                                    Add Songs
                                </Button>
                            </View>
                            {groupTracks.length === 0 ? (
                                <View style={styles.emptyState}>
                                    <Text variant="bodyMedium" style={{ color: TextColors.tertiary }}>No tracks in this group.</Text>
                                </View>
                            ) : (
                                <FlatList
                                    data={groupTracks}
                                    keyExtractor={(item) => item.videoId}
                                    renderItem={({ item }) => (
                                        <Card style={styles.trackCard} mode="contained">
                                            <Card.Content style={styles.cardContent}>
                                                <View style={styles.trackInfo}>
                                                    <Text variant="bodyLarge" numberOfLines={1} style={{ color: TextColors.primary }}>{item.title}</Text>
                                                    <Text variant="bodySmall" style={{ color: TextColors.muted }}>{item.author}</Text>
                                                </View>
                                                <IconButton
                                                    icon="delete"
                                                    iconColor={theme.colors.error}
                                                    onPress={() => handleRemoveTrack(item.videoId)}
                                                />
                                            </Card.Content>
                                        </Card>
                                    )}
                                />
                            )}
                        </View>
                    )}
                </BlurView>
            </Modal>
        </Portal>
    );
}

const styles = StyleSheet.create({
    modalContainer: {
        margin: 20,
        borderRadius: 20,
        overflow: 'hidden',
        maxHeight: '80%',
    },
    blurContainer: {
        padding: Spacing.xl,
        height: '100%',
        backgroundColor: SurfaceColors.modal,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    divider: {
        backgroundColor: BorderColors.subtle,
        marginBottom: 10,
    },
    content: {
        flex: 1,
    },
    subHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    trackCard: {
        marginBottom: Spacing.sm,
        backgroundColor: SurfaceColors.listItem,
    },
    cardContent: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 12, // Reduced padding for compactness
    },
    trackInfo: {
        flex: 1,
        marginRight: 8,
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
    },
});
