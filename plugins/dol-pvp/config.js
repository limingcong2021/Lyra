/**
 * DoL联机单挑插件 - 配置文件
 * 这个文件包含插件的所有可配置选项
 * 用户可以根据需要修改这些设置
 */

// 主配置对象
export const DOLPVP_CONFIG = {
    /**
     * WebSocket信令服务器配置
     * 信令服务器用于初始连接建立和WebRTC握手
     */
    signalingServer: {
        // 信令服务器的WebSocket URL
        // 生产环境应该使用wss://协议（安全WebSocket）
        url: 'wss://your-signaling-server-url.com/ws',
        
        // 备用信令服务器URL（如果主要服务器不可用）
        fallbackUrls: [
            'wss://fallback1-signaling-server.com/ws',
            'wss://fallback2-signaling-server.com/ws'
        ],
        
        // 连接超时时间（毫秒）
        connectionTimeout: 5000,
        
        // 重连尝试次数
        maxReconnectAttempts: 3,
        
        // 重连间隔（毫秒）
        reconnectInterval: 2000
    },

    /**
     * WebRTC配置
     */
    webrtc: {
        // STUN/TURN服务器配置
        iceServers: [
            {
                urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']
            }
            // 可选：添加TURN服务器以提高连接成功率
            /*
            {
                urls: 'turn:your-turn-server.com:3478',
                username: 'your-username',
                credential: 'your-credential'
            }
            */
        ],
        
        // WebRTC连接配置
        iceCandidatePoolSize: 10,
        
        // 是否优先使用中继（TURN）
        forceRelay: false,
        
        // 数据通道配置
        dataChannel: {
            // 数据通道名称
            name: 'dol-pvp-data',
            
            // 是否启用有序传输
            ordered: true,
            
            // 最大重传次数
            maxRetransmits: 5,
            
            // 是否使用 negotiated 模式
            negotiated: false,
            
            // 如果使用 negotiated 模式，指定数据通道ID
            id: null
        }
    },

    /**
     * 游戏状态同步配置
     */
    sync: {
        // 状态同步频率（毫秒）
        stateSyncInterval: 100,
        
        // 动作批处理延迟（毫秒）
        actionBatchDelay: 50,
        
        // 是否启用输入预测
        enablePrediction: true,
        
        // 是否启用状态插值
        enableInterpolation: true,
        
        // 插值缓冲区大小（帧数）
        interpolationBufferSize: 3,
        
        // 最大允许的网络延迟（毫秒）
        maxAcceptableLatency: 200,
        
        // 严重不同步的阈值（毫秒）
        desyncThreshold: 300
    },

    /**
     * 冲突解决配置
     */
    conflict: {
        // 冲突解决策略：'latest'（最新优先）、'authoritative'（房主优先）、'timestamp'（时间戳）
        resolutionStrategy: 'authoritative',
        
        // 是否启用冲突日志
        enableConflictLogging: false,
        
        // 最大历史状态保留数量
        maxHistoryStates: 50,
        
        // 自动重同步阈值（状态差异百分比）
        autoResyncThreshold: 0.3 // 30%
    },

    /**
     * UI配置
     */
    ui: {
        // 是否启用PVP UI
        enabled: true,
        
        // UI样式主题: 'light', 'dark', 'game' (跟随游戏主题)
        theme: 'game',
        
        // 房间列表刷新间隔（毫秒）
        roomListRefreshInterval: 5000,
        
        // 是否显示网络统计
        showNetworkStats: false,
        
        // 是否显示帧率计数器
        showFpsCounter: false,
        
        // PVP面板位置: 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'
        panelPosition: 'top-right',
        
        // PVP面板透明度
        panelOpacity: 0.95
    },

    /**
     * 调试配置
     */
    debug: {
        // 是否启用调试模式
        enabled: false,
        
        // 日志级别: 'error', 'warn', 'info', 'debug', 'verbose'
        logLevel: 'info',
        
        // 是否在控制台显示WebRTC连接状态
        logConnectionStatus: false,
        
        // 是否记录所有网络消息
        logNetworkMessages: false,
        
        // 是否记录状态同步详情
        logStateSync: false,
        
        // 是否记录冲突解决详情
        logConflicts: false
    },

    /**
     * 兼容性配置
     */
    compatibility: {
        // 自动检测平台
        autoDetectPlatform: true,
        
        // 强制使用特定平台模式
        // 可选值: 'github-pages', 'cloudflare-pages', 'localhost', null
        forcePlatform: null,
        
        // 是否在安全上下文外使用降级模式
        allowNonSecureContext: false,
        
        // 是否启用polyfills（用于兼容性较差的浏览器）
        usePolyfills: true
    },

    /**
     * 安全性配置
     */
    security: {
        // 是否验证玩家身份
        verifyPlayerIdentity: true,
        
        // 最大允许的消息大小（字节）
        maxMessageSize: 1024 * 64, // 64KB
        
        // 是否启用消息签名验证
        enableMessageSigning: false,
        
        // 是否启用速率限制
        enableRateLimiting: true,
        
        // 消息速率限制（每秒消息数）
        messageRateLimit: 20
    },

    /**
     * 资源管理配置
     */
    resources: {
        // 自动清理不活跃的工作线程
        autoCleanupWorkers: true,
        
        // Web Worker空闲超时（毫秒）
        workerIdleTimeout: 60000,
        
        // 是否预加载资源
        preloadResources: true
    },

    /**
     * PVP对战规则配置
     */
    battleRules: {
        // 回合制还是实时制: 'turn-based', 'real-time'
        mode: 'turn-based',
        
        // 每个回合的最大时间（秒）
        maxTurnTime: 30,
        
        // 战斗最大持续时间（分钟）
        maxBattleDuration: 30,
        
        // 是否允许物品使用
        allowItemUse: true,
        
        // 是否允许逃跑
        allowEscape: true,
        
        // 胜利条件: 'hp-zero', 'timeout', 'points'
        victoryCondition: 'hp-zero',
        
        // 禁用的技能或动作
        disabledActions: [
            // 'summon', 'transform' 等
        ],
        
        // 初始资源倍率（如生命值、魔法值等）
        resourceMultiplier: 1.0
    }
};

/**
 * 获取配置项的辅助函数
 * 支持嵌套路径访问，例如：getConfig('webrtc.iceServers')
 * 
 * @param {string} path - 配置项路径
 * @param {*} defaultValue - 默认值（如果配置项不存在）
 * @returns {*} 配置值或默认值
 */
export function getConfig(path, defaultValue = null) {
    if (!path || typeof path !== 'string') {
        return defaultValue;
    }

    const keys = path.split('.');
    let config = DOLPVP_CONFIG;
    
    for (const key of keys) {
        if (config && typeof config === 'object' && key in config) {
            config = config[key];
        } else {
            return defaultValue;
        }
    }
    
    return config;
}

/**
 * 设置配置项的辅助函数
 * 支持嵌套路径设置，例如：setConfig('debug.enabled', true)
 * 
 * @param {string} path - 配置项路径
 * @param {*} value - 要设置的值
 * @returns {boolean} 设置是否成功
 */
export function setConfig(path, value) {
    if (!path || typeof path !== 'string') {
        return false;
    }

    const keys = path.split('.');
    let config = DOLPVP_CONFIG;
    
    // 遍历到倒数第二个键
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!(key in config) || typeof config[key] !== 'object') {
            config[key] = {};
        }
        config = config[key];
    }
    
    // 设置最后一个键的值
    const lastKey = keys[keys.length - 1];
    config[lastKey] = value;
    
    return true;
}

/**
 * 保存配置到本地存储
 * 
 * @returns {boolean} 保存是否成功
 */
export function saveConfig() {
    try {
        localStorage.setItem('dol-pvp-config', JSON.stringify(DOLPVP_CONFIG));
        return true;
    } catch (error) {
        console.error('保存配置失败:', error);
        return false;
    }
}

/**
 * 从本地存储加载配置
 * 
 * @returns {boolean} 加载是否成功
 */
export function loadConfig() {
    try {
        const savedConfig = localStorage.getItem('dol-pvp-config');
        if (savedConfig) {
            const parsedConfig = JSON.parse(savedConfig);
            
            // 合并保存的配置到默认配置
            Object.assign(DOLPVP_CONFIG, parsedConfig);
            return true;
        }
    } catch (error) {
        console.error('加载配置失败:', error);
    }
    
    return false;
}

/**
 * 重置配置到默认值
 * 
 * @returns {boolean} 重置是否成功
 */
export function resetConfig() {
    try {
        localStorage.removeItem('dol-pvp-config');
        
        // 重新初始化DOLPVP_CONFIG
        Object.assign(DOLPVP_CONFIG, {
            signalingServer: {
                url: 'wss://your-signaling-server-url.com/ws',
                fallbackUrls: [],
                connectionTimeout: 5000,
                maxReconnectAttempts: 3,
                reconnectInterval: 2000
            },
            // ... 其他默认配置 ...
        });
        
        return true;
    } catch (error) {
        console.error('重置配置失败:', error);
        return false;
    }
}