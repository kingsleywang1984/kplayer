const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files within the monorepo
config.watchFolders = [workspaceRoot];

// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Force resolution of critical dependencies to the local version
config.resolver.extraNodeModules = {
    ...config.resolver.extraNodeModules,
    'react': path.resolve(workspaceRoot, 'node_modules/react'),
    'react-native': path.resolve(workspaceRoot, 'node_modules/react-native'),
    'react-dom': path.resolve(workspaceRoot, 'node_modules/react-dom'),
    '@expo/vector-icons': path.resolve(workspaceRoot, 'node_modules/@expo/vector-icons'),
};

// Note: blocklist removed to allow resolution from workspace root

config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (
        moduleName.startsWith('three/examples/jsm/') &&
        !moduleName.endsWith('.js')
    ) {
        return context.resolveRequest(context, moduleName + '.js', platform);
    }
    return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
