/**
 * DoL联机单挑插件 - 主模块
 * 提供基于Web Worker的联机功能，支持玩家创建/加入房间并进行实时战斗
 */
class DOLPVPPlugin {
    constructor() {
        this.isInitialized = false;
        this.worker = null;
        this.roomId = null;
        this.playerId = null;
        this.isHost = false;
        this.connectedPlayer = null;
        this.gameState = null;
        this.eventListeners = new Map();
        this.pendingActions = [];
        this.lastSyncTime = 0;
        this.currentLocation = null;
        this.combatRequests = new Map(); // 战斗请求映射表
        this.combatActive = false; // 当前是否有活跃战斗
        this.config = {
            serverUrl: 'wss://your-signaling-server.com', // 信令服务器URL
            syncInterval: 100, // 状态同步间隔（毫秒）
            maxLatency: 500, // 最大容忍延迟（毫秒）
            autoReconnect: true, // 自动重连
            debug: true, // 调试模式
            locationCheckInterval: 1000 // 位置检查间隔（毫秒）
        };
    }

    /**
     * 初始化插件
     * @param {Object} options - 配置选项
     */
    init(options = {}) {
        if (this.isInitialized) {
            console.warn('DOLPVPPlugin: 插件已经初始化');
            return;
        }

        // 合并配置选项
        this.config = { ...this.config, ...options };

        try {
            // 创建Web Worker
            this.worker = new Worker('plugins/dol-pvp/network-worker.js');
            
            // 设置Worker消息处理
            this.worker.onmessage = this._handleWorkerMessage.bind(this);
            this.worker.onerror = this._handleWorkerError.bind(this);

            // 向Worker发送初始化消息
            this.worker.postMessage({
                type: 'INIT',
                config: this.config
            });

            // 注入UI元素
            this._injectUI();

            // 尝试钩入游戏战斗系统
            this._hookGameSystems();

            // 开始位置监控
            this._startLocationMonitoring();

            this.isInitialized = true;
            this._log('插件初始化成功');
            this._triggerEvent('initialized');
        } catch (error) {
            console.error('DOLPVPPlugin: 初始化失败', error);
            this._triggerEvent('error', { message: error.message });
        }
    }

    /**
     * 检查当前是否在游戏主页
     * @private
     */
    _isOnMainPage() {
        // 根据游戏的实际主页标识进行判断
        // 检查URL或特定的主页元素
        return window.location.pathname === '/' || 
               (document.getElementById && document.getElementById('home-page'));
    }

    /**
     * 创建新的PVP房间
     * @param {Object} roomConfig - 房间配置
     */
    createRoom(roomConfig = {}) {
        if (!this.isInitialized) {
            throw new Error('插件未初始化');
        }

        // 检查是否在主页
        if (!this._isOnMainPage()) {
            alert('只能在游戏主页创建PVP房间！');
            return;
        }

        this.isHost = true;
        this.worker.postMessage({
            type: 'CREATE_ROOM',
            config: roomConfig
        });

        this._log('正在创建PVP房间...');
    }

    /**
     * 加入现有房间
     * @param {string} roomId - 房间ID
     */
    joinRoom(roomId) {
        if (!this.isInitialized) {
            throw new Error('插件未初始化');
        }

        // 检查是否在主页
        if (!this._isOnMainPage()) {
            alert('只能在游戏主页加入PVP房间！');
            return;
        }

        this.isHost = false;
        this.worker.postMessage({
            type: 'JOIN_ROOM',
            roomId: roomId
        });

        this._log(`正在加入房间 ${roomId}...`);
    }

    /**
     * 离开当前房间
     */
    leaveRoom() {
        if (!this.isInitialized || !this.roomId) {
            return;
        }

        this.worker.postMessage({
            type: 'LEAVE_ROOM'
        });

        this.roomId = null;
        this.playerId = null;
        this.isHost = false;
        this.connectedPlayer = null;
        this.pendingActions = [];

        this._log('已离开房间');
        this._triggerEvent('left_room');
    }

    /**
     * 发送战斗请求给另一个玩家
     * @param {string} targetPlayerId - 目标玩家ID
     */
    sendCombatRequest(targetPlayerId) {
        if (!this.isInitialized) {
            throw new Error('插件未初始化');
        }

        const requestId = `${this.playerId}-${Date.now()}`;
        
        this.worker.postMessage({
            type: 'SEND_COMBAT_REQUEST',
            requestId,
            targetPlayerId,
            playerInfo: this._getPlayerInfo(),
            location: this.currentLocation
        });

        this._log(`已发送战斗请求给玩家 ${targetPlayerId}`);
    }

    /**
     * 接受战斗请求
     * @param {string} requestId - 请求ID
     * @param {string} requesterId - 请求者ID
     */
    acceptCombatRequest(requestId, requesterId) {
        if (!this.isInitialized) {
            throw new Error('插件未初始化');
        }

        // 创建战斗房间并邀请请求者加入
        this.createRoom({ 
            type: 'combat',
            inviteOnly: true,
            inviteeId: requesterId
        });

        // 发送接受消息给请求者
        this.worker.postMessage({
            type: 'ACCEPT_COMBAT_REQUEST',
            requestId,
            requesterId,
            roomId: this.roomId
        });

        this._log(`已接受玩家 ${requesterId} 的战斗请求`);
    }

    /**
     * 拒绝战斗请求
     * @param {string} requestId - 请求ID
     * @param {string} requesterId - 请求者ID
     */
    rejectCombatRequest(requestId, requesterId) {
        if (!this.isInitialized) {
            throw new Error('插件未初始化');
        }

        this.worker.postMessage({
            type: 'REJECT_COMBAT_REQUEST',
            requestId,
            requesterId
        });

        // 从战斗请求映射表中移除
        this.combatRequests.delete(requestId);

        this._log(`已拒绝玩家 ${requesterId} 的战斗请求`);
    }

    /**
     * 获取当前玩家信息（包含属性）
     * @private
     */
    _getPlayerInfo() {
        // 从游戏中获取玩家的属性信息
        // 这里需要根据游戏的实际API进行调整
        const player = window.player || window.character || {};
        return {
            name: player.name || '玩家',
            level: player.level || 1,
            stats: {
                strength: player.strength || 10,
                agility: player.agility || 10,
                intelligence: player.intelligence || 10,
                stamina: player.stamina || 10,
                // 其他属性...
                health: player.health || 100,
                maxHealth: player.maxHealth || 100
            }
        };
    }

    /**
     * 发送游戏动作到对手
     * @param {Object} action - 游戏动作数据
     */
    sendAction(action) {
        if (!this.isInitialized || !this.roomId || !this.connectedPlayer) {
            return;
        }

        const actionData = {
            ...action,
            timestamp: Date.now(),
            senderId: this.playerId,
            // 确保战斗动作包含必要的属性信息
            playerStats: this._getPlayerInfo().stats
        };

        // 立即应用到本地（乐观更新）
        this._applyActionLocally(actionData);

        // 发送到网络
        this.worker.postMessage({
            type: 'SEND_ACTION',
            action: actionData
        });
    }

    /**
     * 同步游戏状态
     * @param {Object} state - 游戏状态
     */
    syncGameState(state) {
        if (!this.isInitialized || !this.roomId || !this.connectedPlayer) {
            return;
        }

        // 限制同步频率
        const now = Date.now();
        if (now - this.lastSyncTime < this.config.syncInterval) {
            return;
        }

        this.lastSyncTime = now;
        this.gameState = state;

        this.worker.postMessage({
            type: 'SYNC_STATE',
            state: {
                ...state,
                timestamp: now,
                playerId: this.playerId
            }
        });
    }

    /**
     * 添加事件监听器
     * @param {string} eventName - 事件名称
     * @param {Function} callback - 回调函数
     */
    on(eventName, callback) {
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, []);
        }
        this.eventListeners.get(eventName).push(callback);
    }

    /**
     * 移除事件监听器
     * @param {string} eventName - 事件名称
     * @param {Function} callback - 回调函数
     */
    off(eventName, callback) {
        if (!this.eventListeners.has(eventName)) return;
        
        const listeners = this.eventListeners.get(eventName);
        const index = listeners.indexOf(callback);
        if (index > -1) {
            listeners.splice(index, 1);
        }
    }

    /**
     * 销毁插件
     */
    destroy() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }

        this.isInitialized = false;
        this.roomId = null;
        this.playerId = null;
        this.connectedPlayer = null;
        this.eventListeners.clear();
        this.pendingActions = [];

        // 清理UI元素
        this._removeUI();

        this._log('插件已销毁');
    }

    /**
     * 处理Worker消息
     * @private
     */
    _handleWorkerMessage(event) {
        const { type, data } = event.data;

        switch (type) {
            case 'ROOM_CREATED':
                this.roomId = data.roomId;
                this.playerId = data.playerId;
                this._log(`房间创建成功: ${this.roomId}`);
                this._triggerEvent('room_created', { roomId: this.roomId });
                break;

            case 'ROOM_JOINED':
                this.roomId = data.roomId;
                this.playerId = data.playerId;
                this._log(`成功加入房间: ${this.roomId}`);
                this._triggerEvent('room_joined', { roomId: this.roomId });
                break;

            case 'PLAYER_CONNECTED':
                this.connectedPlayer = data.player;
                this._log(`玩家已连接: ${data.player.name}`);
                this._triggerEvent('player_connected', { player: data.player });
                break;

            case 'PLAYER_DISCONNECTED':
                this._log(`玩家已断开连接: ${data.playerId}`);
                this._triggerEvent('player_disconnected', { playerId: data.playerId });
                break;

            case 'ACTION_RECEIVED':
                this._handleReceivedAction(data.action);
                break;

            case 'STATE_RECEIVED':
                this._handleReceivedState(data.state);
                break;

            case 'COMBAT_REQUEST_RECEIVED':
                this._handleCombatRequest(data);
                break;

            case 'COMBAT_REQUEST_ACCEPTED':
                this._log(`战斗请求已被接受`);
                // 加入对方创建的战斗房间
                this.joinRoom(data.roomId);
                this._triggerEvent('combat_request_accepted', data);
                break;

            case 'COMBAT_REQUEST_REJECTED':
                this._log(`战斗请求已被拒绝`);
                this._triggerEvent('combat_request_rejected', data);
                break;

            case 'PLAYERS_IN_SAME_LOCATION':
                this._handlePlayersInSameLocation(data.players);
                break;

            case 'ERROR':
                this._log(`网络错误: ${data.message}`, true);
                this._triggerEvent('error', { message: data.message });
                break;

            default:
                this._log(`未知消息类型: ${type}`);
        }
    }

    /**
     * 处理Worker错误
     * @private
     */
    _handleWorkerError(error) {
        console.error('DOLPVPPlugin Worker错误:', error);
        this._triggerEvent('error', { message: error.message });
    }

    /**
     * 处理接收到的战斗请求
     * @private
     */
    _handleCombatRequest(data) {
        const { requestId, requesterId, playerInfo, location } = data;
        
        // 存储战斗请求
        this.combatRequests.set(requestId, {
            requestId,
            requesterId,
            playerInfo,
            location,
            timestamp: Date.now()
        });

        // 显示战斗请求UI
        this._showCombatRequestUI(requestId, requesterId, playerInfo.name);
        
        this._log(`收到来自玩家 ${requesterId} 的战斗请求`);
        this._triggerEvent('combat_request_received', data);
    }

    /**
     * 处理在同一位置的玩家
     * @private
     */
    _handlePlayersInSameLocation(players) {
        // 过滤掉自己
        const otherPlayers = players.filter(p => p.playerId !== this.playerId);
        
        if (otherPlayers.length > 0) {
            this._showPlayersNearbyUI(otherPlayers);
            this._log(`检测到 ${otherPlayers.length} 名玩家在同一位置`);
        }
    }

    /**
     * 显示战斗请求UI
     * @private
     */
    _showCombatRequestUI(requestId, requesterId, playerName) {
        // 创建战斗请求对话框
        const dialog = document.createElement('div');
        dialog.id = `combat-request-${requestId}`;
        dialog.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 20px;
            border-radius: 8px;
            z-index: 10001;
            text-align: center;
            min-width: 300px;
        `;

        dialog.innerHTML = `
            <h3>战斗邀请</h3>
            <p>${playerName} 向你发起了战斗邀请！</p>
            <div style="display: flex; gap: 10px; justify-content: center; margin-top: 20px;">
                <button id="accept-${requestId}" style="padding: 8px 16px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;">接受</button>
                <button id="reject-${requestId}" style="padding: 8px 16px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">拒绝</button>
            </div>
        `;

        document.body.appendChild(dialog);

        // 设置接受按钮事件
        document.getElementById(`accept-${requestId}`).addEventListener('click', () => {
            this.acceptCombatRequest(requestId, requesterId);
            dialog.remove();
        });

        // 设置拒绝按钮事件
        document.getElementById(`reject-${requestId}`).addEventListener('click', () => {
            this.rejectCombatRequest(requestId, requesterId);
            dialog.remove();
        });

        // 超时自动拒绝
        setTimeout(() => {
            if (document.getElementById(dialog.id)) {
                this.rejectCombatRequest(requestId, requesterId);
                dialog.remove();
            }
        }, 30000); // 30秒超时
    }

    /**
     * 显示附近玩家UI
     * @private
     */
    _showPlayersNearbyUI(players) {
        // 检查是否已经存在对话框
        let dialog = document.getElementById('players-nearby-dialog');
        if (dialog) {
            dialog.remove();
        }

        // 创建附近玩家对话框
        dialog = document.createElement('div');
        dialog.id = 'players-nearby-dialog';
        dialog.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 15px;
            border-radius: 8px;
            z-index: 10000;
            max-width: 300px;
        `;

        let playersHtml = players.map(player => `
            <div style="margin-bottom: 10px; padding: 8px; background: rgba(255, 255, 255, 0.1); border-radius: 4px;">
                <div>${player.name}</div>
                <button data-player-id="${player.playerId}" class="challenge-btn" style="margin-top: 5px; padding: 5px 10px; background: #ff9800; color: white; border: none; border-radius: 4px; cursor: pointer;">挑战</button>
            </div>
        `).join('');

        dialog.innerHTML = `
            <h4 style="margin-top: 0;">附近玩家</h4>
            <div id="nearby-players-list">${playersHtml}</div>
            <button id="close-nearby" style="margin-top: 10px; padding: 5px 10px; background: #757575; color: white; border: none; border-radius: 4px; cursor: pointer;">关闭</button>
        `;

        document.body.appendChild(dialog);

        // 添加挑战按钮事件
        document.querySelectorAll('.challenge-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetPlayerId = btn.getAttribute('data-player-id');
                this.sendCombatRequest(targetPlayerId);
                dialog.remove();
            });
        });

        // 添加关闭按钮事件
        document.getElementById('close-nearby').addEventListener('click', () => {
            dialog.remove();
        });
    }

    /**
     * 处理接收到的动作
     * @private
     */
    _handleReceivedAction(action) {
        // 检查动作是否已经应用过（防止重复）
        if (this.pendingActions.some(a => a.id === action.id)) {
            return;
        }

        // 应用接收到的动作
        this._applyAction(action);
        
        // 从待处理队列中移除
        this.pendingActions = this.pendingActions.filter(a => a.id !== action.id);

        this._triggerEvent('action_received', { action });
    }

    /**
     * 处理接收到的游戏状态
     * @private
     */
    _handleReceivedState(state) {
        // 冲突检测和解决
        const resolvedState = this._resolveStateConflict(this.gameState, state);
        this.gameState = resolvedState;

        this._triggerEvent('state_updated', { state: resolvedState });
    }

    /**
     * 计算战斗伤害
     * @private
     */
    _calculateDamage(attackerStats, defenderStats) {
        // 基于角色属性计算伤害
        // 这里可以根据游戏的实际伤害计算公式进行调整
        const attackPower = attackerStats.strength * 2 + attackerStats.agility * 0.5;
        const defensePower = defenderStats.strength * 1.5 + defenderStats.agility * 0.5;
        
        // 基础伤害计算
        let damage = attackPower - defensePower * 0.7;
        
        // 确保伤害至少为1
        damage = Math.max(1, Math.round(damage));
        
        // 添加暴击几率（基于敏捷）
        const critChance = Math.min(0.2, attackerStats.agility / 100);
        if (Math.random() < critChance) {
            damage = Math.round(damage * 1.5);
        }
        
        return damage;
    }

    /**
     * 应用动作到本地游戏状态
     * @private
     */
    _applyActionLocally(action) {
        // 乐观更新本地状态
        if (action.type === 'attack') {
            // 处理攻击动作
            const damage = this._calculateDamage(
                action.playerStats,
                this._getPlayerInfo().stats
            );
            
            // 更新本地玩家的生命值
            // 这里需要与游戏的实际API集成
            if (window.player && window.player.health) {
                window.player.health = Math.max(0, window.player.health - damage);
            }
            
            this._log(`本地受到攻击，造成 ${damage} 点伤害`);
            
            // 检查是否战斗结束
            if (window.player && window.player.health <= 0) {
                this._handleCombatEnd(false); // 失败
            }
        }
        
        this._log(`本地应用动作: ${action.type}`);
    }

    /**
     * 应用接收到的动作
     * @private
     */
    _applyAction(action) {
        // 应用远程玩家的动作
        if (action.type === 'attack') {
            // 处理攻击动作
            const damage = this._calculateDamage(
                this._getPlayerInfo().stats,
                action.playerStats
            );
            
            // 这里应该通过Worker发送伤害响应
            this.sendAction({
                type: 'damage_response',
                damage: damage,
                targetId: action.senderId
            });
        } else if (action.type === 'damage_response') {
            // 处理伤害响应
            if (window.player && window.player.health) {
                window.player.health = Math.max(0, window.player.health - action.damage);
            }
            
            this._log(`受到远程攻击，造成 ${action.damage} 点伤害`);
            
            // 检查是否战斗结束
            if (window.player && window.player.health <= 0) {
                this._handleCombatEnd(false); // 失败
            }
        }
        
        this._log(`应用远程动作: ${action.type}`);
    }

    /**
     * 处理战斗结束
     * @private
     */
    _handleCombatEnd(isVictory) {
        this.combatActive = false;
        
        // 显示战斗结果
        const resultMessage = isVictory ? '战斗胜利！' : '战斗失败！';
        
        const resultDialog = document.createElement('div');
        resultDialog.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 20px;
            border-radius: 8px;
            z-index: 10001;
            text-align: center;
        `;
        
        resultDialog.innerHTML = `
            <h3>${resultMessage}</h3>
            <button id="combat-result-close" style="margin-top: 15px; padding: 8px 16px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer;">关闭</button>
        `;
        
        document.body.appendChild(resultDialog);
        
        document.getElementById('combat-result-close').addEventListener('click', () => {
            resultDialog.remove();
            // 战斗结束后离开房间
            this.leaveRoom();
        });
        
        // 通知对方战斗结果
        this.sendAction({
            type: 'combat_end',
            victory: isVictory
        });
        
        this._log(`战斗结束: ${isVictory ? '胜利' : '失败'}`);
    }

    /**
     * 解决状态冲突
     * @private
     */
    _resolveStateConflict(localState, remoteState) {
        // 使用时间戳和优先级解决冲突
        if (!localState || !remoteState) {
            return localState || remoteState;
        }

        // 基于时间戳的简单冲突解决
        if (remoteState.timestamp > localState.timestamp) {
            return remoteState;
        }

        return localState;
    }

    /**
     * 开始位置监控
     * @private
     */
    _startLocationMonitoring() {
        // 定期检查玩家位置
        setInterval(() => {
            this._updatePlayerLocation();
        }, this.config.locationCheckInterval);
        
        this._log('位置监控已启动');
    }

    /**
     * 更新玩家位置
     * @private
     */
    _updatePlayerLocation() {
        try {
            // 从游戏中获取当前位置信息
            // 这里需要根据游戏的实际API进行调整
            let currentLocation = null;
            
            // 示例：从游戏状态或DOM中获取位置信息
            if (window.location && window.location.pathname) {
                currentLocation = window.location.pathname;
            }
            
            // 或者尝试从游戏特定对象获取
            if (!currentLocation && window.gameState && window.gameState.location) {
                currentLocation = window.gameState.location;
            }
            
            // 如果位置发生变化，通知服务器
            if (currentLocation && currentLocation !== this.currentLocation) {
                this.currentLocation = currentLocation;
                
                if (this.worker && this.playerId) {
                    this.worker.postMessage({
                        type: 'UPDATE_LOCATION',
                        location: currentLocation,
                        playerId: this.playerId
                    });
                }
                
                this._log(`位置已更新: ${currentLocation}`);
            }
        } catch (error) {
            this._log(`位置更新失败: ${error.message}`, true);
        }
    }

    /**
     * 钩入游戏系统
     * @private
     */
    _hookGameSystems() {
        try {
            // 这里需要根据游戏的实际API进行调整
            // 示例：钩入战斗开始和结束事件
            const originalBattleStart = window.battleStart || function() {};
            const plugin = this;

            window.battleStart = function(enemy) {
                // 如果是PVP战斗，处理特殊逻辑
                if (plugin.connectedPlayer) {
                    plugin.combatActive = true;
                    plugin._log('PVP战斗开始');
                    plugin._triggerEvent('battle_start', { enemy });
                    
                    // 初始化PVP战斗UI
                    plugin._initPvpCombatUI();
                }
                return originalBattleStart.apply(this, arguments);
            };

            // 尝试钩入游戏状态更新函数
            // 这里需要根据游戏的实际更新机制进行调整
            if (window.updateGameState) {
                const originalUpdateState = window.updateGameState;
                window.updateGameState = function() {
                    // 调用原始函数
                    const result = originalUpdateState.apply(this, arguments);
                    
                    // 如果有活跃的PVP战斗，同步状态
                    if (plugin.combatActive && plugin.connectedPlayer) {
                        plugin.syncGameState({
                            playerStats: plugin._getPlayerInfo().stats,
                            timestamp: Date.now()
                        });
                    }
                    
                    return result;
                };
            }

            this._log('已钩入游戏系统');
        } catch (error) {
            console.error('DOLPVPPlugin: 钩入游戏系统失败', error);
        }
    }

    /**
     * 初始化PVP战斗UI
     * @private
     */
    _initPvpCombatUI() {
        // 检查是否已经存在战斗UI
        let combatUI = document.getElementById('pvp-combat-ui');
        if (combatUI) {
            combatUI.remove();
        }

        // 创建战斗UI
        combatUI = document.createElement('div');
        combatUI.id = 'pvp-combat-ui';
        combatUI.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 20px;
            border-radius: 8px;
            z-index: 10002;
            min-width: 400px;
        `;

        // 获取玩家信息
        const playerInfo = this._getPlayerInfo();

        combatUI.innerHTML = `
            <h3>PVP战斗</h3>
            <div style="display: flex; justify-content: space-between; margin-bottom: 20px;">
                <div>
                    <h4>我方</h4>
                    <div>生命值: <span id="player-health">${playerInfo.stats.health}/${playerInfo.stats.maxHealth}</span></div>
                    <div>力量: ${playerInfo.stats.strength}</div>
                    <div>敏捷: ${playerInfo.stats.agility}</div>
                    <div>智力: ${playerInfo.stats.intelligence}</div>
                </div>
                <div>
                    <h4>对手: ${this.connectedPlayer?.name || '未知'}</h4>
                    <div>生命值: <span id="opponent-health">--</span></div>
                </div>
            </div>
            <div style="display: flex; gap: 10px; justify-content: center;">
                <button id="pvp-attack" style="padding: 10px 20px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px;">攻击</button>
                <button id="pvp-defend" style="padding: 10px 20px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px;">防御</button>
                <button id="pvp-flee" style="padding: 10px 20px; background: #ff9800; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px;">逃跑</button>
            </div>
        `;

        document.body.appendChild(combatUI);

        // 添加战斗按钮事件
        document.getElementById('pvp-attack').addEventListener('click', () => {
            this.sendAction({ type: 'attack' });
        });

        document.getElementById('pvp-defend').addEventListener('click', () => {
            this.sendAction({ type: 'defend' });
        });

        document.getElementById('pvp-flee').addEventListener('click', () => {
            if (confirm('确定要逃跑吗？逃跑可能会受到惩罚。')) {
                this.sendAction({ type: 'flee' });
                this._handleCombatEnd(false);
            }
        });

        // 监听生命值变化并更新UI
        this.on('state_updated', ({ state }) => {
            if (state && state.playerStats && state.playerStats.health) {
                document.getElementById('opponent-health').textContent = 
                    `${state.playerStats.health}/${state.playerStats.maxHealth || state.playerStats.health}`;
            }
        });

        // 监听本地玩家生命值变化
        setInterval(() => {
            const player = window.player || window.character || {};
            if (player.health !== undefined) {
                const maxHealth = player.maxHealth || 100;
                document.getElementById('player-health').textContent = 
                    `${player.health}/${maxHealth}`;
                
                // 检查是否战斗结束
                if (player.health <= 0 && this.combatActive) {
                    this._handleCombatEnd(false);
                }
            }
        }, 100);
    }

    /**
     * 注入UI元素
     * @private
     */
    _injectUI() {
        // 创建PVP面板
        const pvpPanel = document.createElement('div');
        pvpPanel.id = 'dol-pvp-panel';
        pvpPanel.style.cssText = `
            position: fixed;
            top: 50px;
            right: 10px;
            width: 300px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 15px;
            border-radius: 8px;
            z-index: 9999;
            font-family: Arial, sans-serif;
            display: none;
        `;

        // 添加面板内容
        pvpPanel.innerHTML = `
            <h3 style="margin-top: 0;">PVP对战</h3>
            <div id="pvp-status" style="margin-bottom: 10px;">未连接</div>
            <div class="main-page-notice" style="display: none; margin-bottom: 10px; color: #ff9800; padding: 8px; background: rgba(255, 152, 0, 0.2); border-radius: 4px;">
                注意：只能在游戏主页创建或加入房间
            </div>
            <div>
                <input type="text" id="pvp-room-id" placeholder="房间ID" style="width: 100%; padding: 5px; margin-bottom: 10px;">
            </div>
            <div style="display: flex; gap: 5px;">
                <button id="pvp-create-room" style="flex: 1; padding: 5px;">创建房间</button>
                <button id="pvp-join-room" style="flex: 1; padding: 5px;">加入房间</button>
                <button id="pvp-leave-room" style="flex: 1; padding: 5px;" disabled>离开房间</button>
            </div>
            <div id="pvp-actions" style="margin-top: 15px; display: none;">
                <h4>战斗控制</h4>
                <!-- 战斗控制按钮将在这里动态添加 -->
            </div>
            <div id="player-stats" style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255, 255, 255, 0.3);">
                <h4>角色属性</h4>
                <div id="stats-content">加载中...</div>
            </div>
        `;

        // 添加到文档
        document.body.appendChild(pvpPanel);

        // 添加事件监听器
        document.getElementById('pvp-create-room').addEventListener('click', () => this.createRoom());
        document.getElementById('pvp-join-room').addEventListener('click', () => {
            const roomId = document.getElementById('pvp-room-id').value.trim();
            if (roomId) {
                this.joinRoom(roomId);
            }
        });
        document.getElementById('pvp-leave-room').addEventListener('click', () => this.leaveRoom());

        // 添加切换显示按钮
        const toggleButton = document.createElement('button');
        toggleButton.id = 'dol-pvp-toggle';
        toggleButton.textContent = 'PVP';
        toggleButton.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: #6a11cb;
            color: white;
            border: none;
            padding: 5px 10px;
            border-radius: 4px;
            cursor: pointer;
            z-index: 10000;
        `;

        toggleButton.addEventListener('click', () => {
            // 切换面板显示
            pvpPanel.style.display = pvpPanel.style.display === 'none' ? 'block' : 'none';
            
            // 根据是否在主页显示提示
            const noticeElement = pvpPanel.querySelector('.main-page-notice');
            if (noticeElement) {
                noticeElement.style.display = this._isOnMainPage() ? 'none' : 'block';
            }
            
            // 更新角色属性显示
            this._updatePlayerStatsUI();
        });

        document.body.appendChild(toggleButton);

        // 监听插件事件来更新UI
        this.on('room_created', ({ roomId }) => {
            document.getElementById('pvp-room-id').value = roomId;
            document.getElementById('pvp-status').textContent = `房间已创建: ${roomId}`;
            document.getElementById('pvp-leave-room').disabled = false;
        });

        this.on('room_joined', ({ roomId }) => {
            document.getElementById('pvp-status').textContent = `已加入房间: ${roomId}`;
            document.getElementById('pvp-leave-room').disabled = false;
        });

        this.on('player_connected', ({ player }) => {
            document.getElementById('pvp-status').textContent = `对手已连接: ${player.name}`;
            document.getElementById('pvp-actions').style.display = 'block';
            
            // 添加战斗开始按钮
            const actionsDiv = document.getElementById('pvp-actions');
            actionsDiv.innerHTML = `
                <h4>战斗控制</h4>
                <button id="pvp-start-combat" style="width: 100%; padding: 8px; margin-bottom: 5px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">开始战斗</button>
            `;
            
            document.getElementById('pvp-start-combat').addEventListener('click', () => {
                // 触发战斗开始
                if (window.battleStart) {
                    window.battleStart(player);
                } else {
                    // 如果游戏没有提供战斗开始函数，直接初始化PVP战斗UI
                    this.combatActive = true;
                    this._initPvpCombatUI();
                }
            });
        });

        this.on('player_disconnected', () => {
            document.getElementById('pvp-status').textContent = '对手已断开连接';
            document.getElementById('pvp-actions').style.display = 'none';
        });

        this.on('left_room', () => {
            document.getElementById('pvp-status').textContent = '未连接';
            document.getElementById('pvp-leave-room').disabled = true;
            document.getElementById('pvp-actions').style.display = 'none';
        });

        this._log('UI元素已注入');
    }

    /**
     * 更新玩家属性UI显示
     * @private
     */
    _updatePlayerStatsUI() {
        try {
            const playerInfo = this._getPlayerInfo();
            const statsContent = document.getElementById('stats-content');
            
            if (statsContent) {
                statsContent.innerHTML = `
                    <div>力量: ${playerInfo.stats.strength}</div>
                    <div>敏捷: ${playerInfo.stats.agility}</div>
                    <div>智力: ${playerInfo.stats.intelligence}</div>
                    <div>耐力: ${playerInfo.stats.stamina}</div>
                    <div>生命值: ${playerInfo.stats.health}/${playerInfo.stats.maxHealth}</div>
                `;
            }
        } catch (error) {
            this._log(`更新玩家属性UI失败: ${error.message}`, true);
        }
    }

    /**
     * 移除UI元素
     * @private
     */
    _removeUI() {
        const panel = document.getElementById('dol-pvp-panel');
        const toggle = document.getElementById('dol-pvp-toggle');
        
        if (panel) panel.remove();
        if (toggle) toggle.remove();
    }

    /**
     * 触发事件
     * @private
     */
    _triggerEvent(eventName, data = {}) {
        if (!this.eventListeners.has(eventName)) return;
        
        this.eventListeners.get(eventName).forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`DOLPVPPlugin: 事件监听器错误 (${eventName})`, error);
            }
        });
    }

    /**
     * 日志记录
     * @private
     */
    _log(message, isError = false) {
        if (!this.config.debug && !isError) return;
        
        const prefix = '[DOL-PVP]';
        if (isError) {
            console.error(`${prefix} ${message}`);
        } else {
            console.log(`${prefix} ${message}`);
        }
    }
}

// 导出插件实例
const dolPvpPlugin = new DOLPVPPlugin();

// 尝试自动初始化
if (typeof window !== 'undefined') {
    window.dolPvpPlugin = dolPvpPlugin;
    
    // 等待DOM加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            dolPvpPlugin.init();
        });
    } else {
        // 如果DOM已加载，立即初始化
        dolPvpPlugin.init();
    }
}

export default dolPvpPlugin;