/**
 * DoL联机单挑插件 - Pages平台适配层
 * 为插件提供平台兼容性支持，确保在GitHub Pages、Cloudflare Pages等环境中正常运行
 */

class PagesAdapter {
    constructor(options = {}) {
        this.options = {
            // 默认配置选项
            autoDetectPlatform: true,  // 自动检测平台类型
            basePath: '',              // 基础路径，用于资源加载
            signalingServerUrl: null,  // 信令服务器URL（如果为null则根据平台自动选择）
            useHttpsOnly: true,        // 只使用HTTPS连接
            enableCors: true,          // 启用跨域资源共享支持
            debug: false,              // 调试模式
            ...options
        };

        // 平台类型和特性
        this.platform = null;
        this.platformFeatures = null;
        this.isSecureContext = false;
        this.workerPath = null;

        // 初始化
        if (this.options.autoDetectPlatform) {
            this.detectPlatform();
        }

        // 检测安全上下文（影响WebRTC等功能）
        this.checkSecureContext();
    }

    /**
     * 检测当前运行平台
     */
    detectPlatform() {
        // 获取当前URL
        const url = window.location.href;
        const hostname = window.location.hostname;
        const pathname = window.location.pathname;

        // 平台检测
        if (hostname.includes('github.io')) {
            this.platform = 'github-pages';
            this._log('检测到平台: GitHub Pages');
        } else if (hostname.includes('pages.dev')) {
            this.platform = 'cloudflare-pages';
            this._log('检测到平台: Cloudflare Pages');
        } else if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
            this.platform = 'localhost';
            this._log('检测到平台: 本地开发环境');
        } else {
            this.platform = 'unknown';
            this._log('未识别的平台');
        }

        // 设置平台特性
        this.setPlatformFeatures();

        // 设置基础路径
        this.setBasePath();

        return this.platform;
    }

    /**
     * 设置平台特定特性
     */
    setPlatformFeatures() {
        this.platformFeatures = {
            webrtcSupport: true,     // 默认支持WebRTC
            corsRestrictions: false, // 默认无特殊CORS限制
            serviceWorkerSupport: true, // 默认支持Service Worker
            recommendedSignalingServer: null
        };

        switch (this.platform) {
            case 'github-pages':
                this.platformFeatures.corsRestrictions = true;
                this.platformFeatures.recommendedSignalingServer = 'wss://dol-pvp-signaling.herokuapp.com';
                break;

            case 'cloudflare-pages':
                this.platformFeatures.corsRestrictions = false; // Cloudflare Pages CORS策略较宽松
                this.platformFeatures.recommendedSignalingServer = 'wss://dol-pvp-signaling.cloudflareworkers.com';
                break;

            case 'localhost':
                this.platformFeatures.corsRestrictions = false;
                this.platformFeatures.recommendedSignalingServer = 'ws://localhost:3000';
                break;
        }

        // 根据useHttpsOnly配置调整推荐的信令服务器URL
        if (this.options.useHttpsOnly && this.platformFeatures.recommendedSignalingServer) {
            this.platformFeatures.recommendedSignalingServer = this.platformFeatures.recommendedSignalingServer.replace(
                'ws://', 'wss://'
            );
        }
    }

    /**
     * 设置基础路径
     */
    setBasePath() {
        // 如果用户明确指定了基础路径，使用用户指定的
        if (this.options.basePath) {
            this.basePath = this._normalizePath(this.options.basePath);
            return;
        }

        // 否则根据平台自动确定
        switch (this.platform) {
            case 'github-pages':
                // GitHub Pages通常使用仓库名作为子路径
                const repoMatch = window.location.pathname.match(/\/(.*?)\//);
                this.basePath = repoMatch ? `/${repoMatch[1]}` : '';
                break;

            case 'cloudflare-pages':
                // Cloudflare Pages可能使用子域名或路径
                this.basePath = '';
                break;

            default:
                this.basePath = '';
        }

        this._log(`设置基础路径: ${this.basePath}`);
    }

    /**
     * 获取适用于当前平台的信令服务器URL
     */
    getSignalingServerUrl() {
        if (this.options.signalingServerUrl) {
            return this.options.signalingServerUrl;
        }

        return this.platformFeatures.recommendedSignalingServer || 
               'wss://dol-pvp-signaling.herokuapp.com';
    }

    /**
     * 获取正确路径的Web Worker URL
     * @param {string} workerFilename - Worker文件名
     */
    getWorkerUrl(workerFilename = 'network-worker.js') {
        // 如果已经计算过，直接返回
        if (this.workerPath) {
            return this.workerPath;
        }

        // 构建正确的Worker路径
        const scriptElement = document.querySelector('script[src*="dol-pvp"]');
        let baseUrl = '';

        if (scriptElement) {
            // 从当前脚本路径推断Worker路径
            const scriptSrc = scriptElement.getAttribute('src');
            baseUrl = scriptSrc.substring(0, scriptSrc.lastIndexOf('/') + 1);
        } else {
            // 如果无法找到脚本元素，使用基础路径
            baseUrl = `${this.basePath}/plugins/dol-pvp/`;
        }

        this.workerPath = `${baseUrl}${workerFilename}`;
        this._log(`Worker路径: ${this.workerPath}`);
        return this.workerPath;
    }

    /**
     * 检查是否处于安全上下文（影响WebRTC等功能）
     */
    checkSecureContext() {
        // 现代浏览器支持window.isSecureContext
        if (window.isSecureContext !== undefined) {
            this.isSecureContext = window.isSecureContext;
        } else {
            // 回退检测：检查协议是否为HTTPS或localhost
            const protocol = window.location.protocol;
            const hostname = window.location.hostname;
            this.isSecureContext = protocol === 'https:' || 
                                  hostname === 'localhost' || 
                                  hostname === '127.0.0.1';
        }

        this._log(`安全上下文: ${this.isSecureContext}`);
        
        // 如果不是安全上下文，WebRTC功能可能受限
        if (!this.isSecureContext) {
            this.platformFeatures.webrtcSupport = false;
            console.warn('DOL-PVP: 当前环境不是安全上下文，WebRTC功能可能受限。请使用HTTPS协议或localhost。');
        }

        return this.isSecureContext;
    }

    /**
     * 获取资源的完整URL（考虑基础路径）
     * @param {string} resourcePath - 资源相对路径
     */
    getResourceUrl(resourcePath) {
        const normalizedPath = this._normalizePath(resourcePath);
        
        // 如果已经是完整URL，直接返回
        if (normalizedPath.startsWith('http://') || normalizedPath.startsWith('https://')) {
            return normalizedPath;
        }

        // 构建完整路径
        if (normalizedPath.startsWith('/')) {
            return `${window.location.origin}${normalizedPath}`;
        }

        return `${window.location.origin}${this.basePath}/${normalizedPath}`;
    }

    /**
     * 准备CORS请求选项
     * @param {Object} options - 请求选项
     */
    prepareCorsOptions(options = {}) {
        if (!this.options.enableCors) {
            return options;
        }

        return {
            ...options,
            credentials: 'include', // 包含凭证信息
            mode: this.platformFeatures.corsRestrictions ? 'cors' : 'no-cors',
            headers: {
                ...options.headers,
                'Access-Control-Allow-Origin': '*' // 客户端设置，实际CORS由服务器控制
            }
        };
    }

    /**
     * 获取平台相关的错误消息
     * @param {string} errorCode - 错误代码
     */
    getPlatformErrorMessage(errorCode) {
        const messages = {
            'no-webrtc': this.isSecureContext 
                ? '您的浏览器不支持WebRTC。请使用Chrome、Firefox或Edge等现代浏览器。'
                : 'WebRTC需要安全上下文。请使用HTTPS协议访问网站。',
            'cors-error': '发生跨域资源共享(CORS)错误。请确保信令服务器配置了正确的CORS策略。',
            'network-error': '网络连接错误。请检查您的网络连接并重试。',
            'worker-error': 'Web Worker加载失败。请确保插件文件路径正确。'
        };

        return messages[errorCode] || '发生未知错误';
    }

    /**
     * 检测浏览器兼容性
     */
    checkBrowserCompatibility() {
        const compatibility = {
            supported: true,
            missingFeatures: []
        };

        // 检查WebSocket支持
        if (!('WebSocket' in window)) {
            compatibility.supported = false;
            compatibility.missingFeatures.push('WebSocket');
        }

        // 检查Web Worker支持
        if (!('Worker' in window)) {
            compatibility.supported = false;
            compatibility.missingFeatures.push('Web Worker');
        }

        // 检查WebRTC支持（可选功能）
        if (!this._isWebRTCSupported() && this.platformFeatures.webrtcSupport) {
            compatibility.missingFeatures.push('WebRTC');
            // WebRTC缺失不会导致整个插件不支持，只是功能受限
        }

        // 检查基础API支持
        if (!('JSON' in window) || !('localStorage' in window)) {
            compatibility.supported = false;
            compatibility.missingFeatures.push('基础Web API');
        }

        this._log(`浏览器兼容性检查: ${compatibility.supported ? '支持' : '不支持'}`);
        if (compatibility.missingFeatures.length > 0) {
            this._log(`缺失特性: ${compatibility.missingFeatures.join(', ')}`);
        }

        return compatibility;
    }

    /**
     * 创建平台特定的配置对象
     */
    createPlatformConfig() {
        return {
            platform: this.platform,
            isSecureContext: this.isSecureContext,
            basePath: this.basePath,
            signalingServerUrl: this.getSignalingServerUrl(),
            workerUrl: this.getWorkerUrl(),
            webrtcSupport: this.platformFeatures.webrtcSupport,
            browserCompatibility: this.checkBrowserCompatibility()
        };
    }

    /**
     * 检查WebRTC支持情况
     * @private
     */
    _isWebRTCSupported() {
        return !!(window.RTCPeerConnection || 
                 window.webkitRTCPeerConnection || 
                 window.mozRTCPeerConnection);
    }

    /**
     * 规范化路径
     * @private
     */
    _normalizePath(path) {
        // 移除开头和结尾的斜杠
        let normalized = path.trim();
        if (normalized.startsWith('/')) {
            normalized = normalized.slice(1);
        }
        if (normalized.endsWith('/')) {
            normalized = normalized.slice(0, -1);
        }
        return normalized;
    }

    /**
     * 日志记录
     * @private
     */
    _log(message) {
        if (this.options.debug) {
            console.log(`[DOL-PVP-ADAPTER] ${message}`);
        }
    }
}

// 导出模块
export default PagesAdapter;