# DoL联机单挑插件 (Degrees of Lewdity PvP Plugin)

这是一个为 Degrees of Lewdity 游戏开发的联机单挑功能插件，允许玩家通过 WebRTC 技术进行 P2P 对战。插件使用 Web Worker 在后台处理网络通信，确保游戏主线程不被阻塞，提供流畅的游戏体验。

## 功能特点

- **基于 Web Worker 的后台处理**：所有网络通信和状态同步在单独的线程中处理，保证游戏主线程流畅运行
- **WebRTC P2P 连接**：使用点对点连接技术，提供低延迟的实时对战体验
- **房间匹配系统**：支持创建或加入对战房间，方便玩家寻找对手
- **智能冲突解决算法**：处理网络延迟或数据不同步导致的问题，保证游戏状态一致性
- **多平台兼容**：适配 GitHub Pages、Cloudflare Pages 等平台的部署环境
- **高度可配置**：提供丰富的配置选项，可根据需要自定义插件行为
- **详细的调试工具**：内置网络状态监控和调试日志功能

## 安装说明

### 方法一：直接复制文件

1. 确保游戏目录中存在 `plugins` 文件夹
2. 将本插件的 `dol-pvp` 文件夹复制到 `plugins` 文件夹中
3. 修改游戏的主入口文件（通常是 `index.html`），添加以下代码：

```html
<!-- 在游戏主 JavaScript 文件加载后添加 -->
<script>
    // 加载 DoL PVP 插件
    (async function() {
        try {
            const pluginPath = './plugins/dol-pvp/main.js';
            const module = await import(pluginPath);
            module.initializePlugin();
            console.log('DoL PVP 插件加载成功');
        } catch (error) {
            console.error('DoL PVP 插件加载失败:', error);
        }
    })();
</script>
```

### 方法二：使用 Mod 加载器（如果游戏支持）

如果游戏支持 mod 加载器，请按照 mod 加载器的说明安装此插件。

## 配置选项

插件的主要配置位于 `plugins/dol-pvp/config.js` 文件中，您可以根据需要修改这些设置：

### 信令服务器配置

```javascript
signalingServer: {
    url: 'wss://your-signaling-server-url.com/ws',  // 主信令服务器 URL
    fallbackUrls: [...],                           // 备用信令服务器
    connectionTimeout: 5000,                       // 连接超时时间
    maxReconnectAttempts: 3,                       // 最大重连次数
    reconnectInterval: 2000                        // 重连间隔
}
```

### WebRTC 配置

```javascript
webrtc: {
    iceServers: [{
        urls: ['stun:stun.l.google.com:19302']      // STUN 服务器
    }],
    // 可添加 TURN 服务器以提高连接成功率
    dataChannel: {
        name: 'dol-pvp-data',                      // 数据通道名称
        ordered: true                              // 是否保证消息顺序
    }
}
```

### 游戏设置

```javascript
battleRules: {
    mode: 'turn-based',                            // 回合制或实时制
    maxTurnTime: 30,                               // 每回合最大时间
    allowItemUse: true,                            // 是否允许使用物品
    allowEscape: true                              // 是否允许逃跑
}
```

### UI 和调试设置

```javascript
ui: {
    enabled: true,                                 // 是否启用 PVP UI
    theme: 'game',                                 // UI 主题
    showNetworkStats: false                        // 是否显示网络统计
},
debug: {
    enabled: false,                                // 是否启用调试模式
    logLevel: 'info'                               // 日志级别
}
```

## 使用说明

### 开始对战

1. 游戏加载完成后，PVP 面板会显示在屏幕上（默认为右上角）
2. 要创建对战房间：
   - 点击 "创建房间" 按钮
   - 设置房间选项（如战斗规则）
   - 创建成功后，您将获得一个房间代码
3. 要加入对战房间：
   - 点击 "加入房间" 按钮
   - 输入好友提供的房间代码
   - 点击 "加入" 按钮
4. 当两位玩家都加入房间后，战斗将自动开始

### 控制选项

- **设置**：打开配置面板，调整插件设置
- **网络测试**：测试您的网络连接状态
- **断开连接**：离开当前房间或断开与对手的连接
- **帮助**：查看使用说明和常见问题

## 信令服务器部署

要使用此插件，您需要一个 WebSocket 信令服务器来处理初始连接和 WebRTC 握手。我们提供了一个简单的示例服务器：

1. 安装 Node.js 和 npm
2. 进入 `plugins/dol-pvp` 目录
3. 安装依赖：`npm install ws`
4. 运行服务器：`node signaling-server-example.js`
5. 将 `config.js` 中的 `signalingServer.url` 设置为您的服务器地址

**注意**：示例服务器仅适用于测试。生产环境部署应考虑安全性、可扩展性和稳定性。

## 常见问题

### 无法连接到对手

- 确保您和对手都能访问信令服务器
- 如果在严格的 NAT 环境中，考虑配置 TURN 服务器
- 检查防火墙设置，确保 WebRTC 连接不受阻止
- 尝试使用 "网络测试" 功能诊断连接问题

### 游戏状态不同步

- 网络延迟可能导致状态不同步，这是正常现象
- 插件有内置的冲突解决机制，会自动调整
- 如果问题持续，尝试降低 `stateSyncInterval` 值
- 确保双方玩家的游戏版本一致

### 性能问题

- 如果游戏运行缓慢，尝试禁用调试模式：`debug.enabled = false`
- 减少 `stateSyncInterval` 值可以降低同步频率
- 关闭不必要的 UI 功能：`ui.showNetworkStats = false`

## 兼容性

- 支持现代浏览器：Chrome 80+, Firefox 75+, Safari 14+, Edge 80+
- 需要 HTTPS 连接或 localhost 环境（WebRTC 安全要求）
- 与 GitHub Pages 和 Cloudflare Pages 兼容
- 移动设备可能需要更强大的硬件以获得流畅体验

## 技术说明

### Web Worker 架构

插件使用 Web Worker 在后台线程处理所有网络通信和状态同步，确保游戏主线程流畅运行。这种架构可以显著提高游戏性能，尤其是在网络条件不佳的情况下。

### WebRTC 通信

插件使用 WebRTC 技术建立点对点连接，无需通过中央服务器转发游戏数据。信令服务器仅用于初始连接建立和 WebRTC 握手，实际游戏数据通过 P2P 通道传输。

### 冲突解决

网络延迟可能导致玩家状态不同步。插件实现了多种冲突解决策略：
- **权威模式**：房主的状态优先
- **最新模式**：最新接收到的状态优先
- **时间戳模式**：基于时间戳解决冲突

### Pages 平台适配

插件包含专门的适配层，可以自动检测部署平台（GitHub Pages、Cloudflare Pages 或本地开发环境），并应用适当的配置以确保兼容性。

## 安全注意事项

- 本插件通过 P2P 连接传输数据，请确保只与信任的玩家对战
- 信令服务器应该使用 WSS（加密 WebSocket）协议
- 避免在公共网络上共享房间代码
- 如发现安全问题，请及时报告

## 开发和调试

### 启用调试模式

1. 修改 `config.js`：`debug.enabled = true`
2. 设置日志级别：`debug.logLevel = 'debug'`
3. 打开浏览器开发者工具查看调试信息

### 自定义扩展

插件架构设计允许自定义扩展，您可以：
- 添加新的战斗规则
- 扩展 UI 功能
- 实现自定义的状态同步逻辑
- 添加新的冲突解决策略

## 许可证

本插件遵循 MIT 许可证。详情请参见 LICENSE 文件。

## 贡献

欢迎提交问题报告、功能请求和代码贡献。请确保您的贡献符合项目的代码规范和质量标准。

## 联系信息

如有问题或建议，请通过 GitHub Issues 或其他指定渠道联系开发者。

---

*注意：此插件仅作为游戏扩展，不应用于任何违反游戏 EULA 或相关规定的目的。使用插件时请遵守游戏的使用条款。*