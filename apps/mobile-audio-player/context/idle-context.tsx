import { createContext, useContext, ReactNode } from 'react';
import { useSharedValue, SharedValue } from 'react-native-reanimated';

type IdleContextValue = {
    isIdleShared: SharedValue<number>;
};

const IdleContext = createContext<IdleContextValue | undefined>(undefined);

export function IdleProvider({ children }: { children: ReactNode }) {
    const isIdleShared = useSharedValue(0); // 0 = not idle, 1 = idle

    return (
        <IdleContext.Provider value={{ isIdleShared }}>
            {children}
        </IdleContext.Provider>
    );
}

export function useIdle() {
    const context = useContext(IdleContext);
    if (!context) {
        throw new Error('useIdle must be used within an IdleProvider');
    }
    return context;
}
