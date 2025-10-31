/**
 * DoL联机单挑插件 - 冲突解决算法模块
 * 处理网络延迟或数据不同步导致的游戏状态冲突，确保双方玩家看到一致的游戏状态
 */

class ConflictResolver {
    constructor(options = {}) {
        this.options = {
            // 默认配置选项
            timestampThreshold: 100, // 时间戳阈值（毫秒），超过此值才认为状态不同
            authorityWeight: 0.6,    // 房主权威权重，值越高房主的状态优先级越高
            confidenceDecay: 0.8,    // 信心衰减因子，控制旧状态的权重衰减
            maxHistoryLength: 100,   // 最大历史记录长度
            debug: false,            // 调试模式
            ...options
        };

        // 游戏状态历史记录
        this.stateHistory = new Map(); // key: playerId, value: [{state, timestamp}]
        
        // 动作日志，用于回放和状态重建
        this.actionLog = [];
        
        // 最后解决时间，避免过于频繁的冲突解决
        this.lastResolutionTime = 0;
        this.minResolutionInterval = 50; // 最小解决间隔（毫秒）
    }

    /**
     * 记录状态更新
     * @param {string} playerId - 玩家ID
     * @param {Object} state - 游戏状态
     * @param {number} timestamp - 时间戳
     */
    recordState(playerId, state, timestamp) {
        if (!this.stateHistory.has(playerId)) {
            this.stateHistory.set(playerId, []);
        }

        const history = this.stateHistory.get(playerId);
        history.push({ state, timestamp });

        // 限制历史记录长度
        if (history.length > this.options.maxHistoryLength) {
            history.shift(); // 移除最旧的记录
        }

        this._log(`记录玩家 ${playerId} 的状态，时间戳: ${timestamp}`);
    }

    /**
     * 记录动作执行
     * @param {Object} action - 游戏动作
     */
    recordAction(action) {
        this.actionLog.push({
            ...action,
            recordedAt: Date.now()
        });

        // 限制动作日志长度
        if (this.actionLog.length > this.options.maxHistoryLength * 2) {
            this.actionLog.shift();
        }
    }

    /**
     * 解决两个状态之间的冲突
     * @param {Object} localState - 本地游戏状态
     * @param {Object} remoteState - 远程游戏状态
     * @param {Object} options - 解决选项
     * @returns {Object} 解决后的游戏状态
     */
    resolve(localState, remoteState, options = {}) {
        const { 
            isLocalAuthoritative = false, // 本地是否具有更高权威（如房主）
            forceResolution = false       // 是否强制解决冲突
        } = options;

        const now = Date.now();
        
        // 避免过于频繁的解决操作
        if (!forceResolution && now - this.lastResolutionTime < this.minResolutionInterval) {
            return localState; // 返回本地状态，避免频繁更新
        }

        this.lastResolutionTime = now;

        // 如果任一状态不存在，返回存在的那个
        if (!localState) return remoteState;
        if (!remoteState) return localState;

        // 确保状态有时间戳
        const localTimestamp = localState.timestamp || 0;
        const remoteTimestamp = remoteState.timestamp || 0;
        
        // 计算时间差
        const timeDiff = Math.abs(localTimestamp - remoteTimestamp);

        // 如果时间差小于阈值，认为两个状态基本同步
        if (timeDiff < this.options.timestampThreshold && !forceResolution) {
            this._log(`状态时间差较小 (${timeDiff}ms)，无需解决冲突`);
            return localState; // 保持本地状态以减少抖动
        }

        // 计算每个状态的信心分数
        const localConfidence = this._calculateConfidence(localState, isLocalAuthoritative);
        const remoteConfidence = this._calculateConfidence(remoteState, !isLocalAuthoritative);

        this._log(`冲突检测: 本地信心=${localConfidence.toFixed(2)}, 远程信心=${remoteConfidence.toFixed(2)}`);

        // 基于信心分数决定使用哪个状态
        if (localConfidence > remoteConfidence) {
            this._log('使用本地状态');
            return this._adjustState(localState, remoteState);
        } else if (remoteConfidence > localConfidence) {
            this._log('使用远程状态');
            return this._adjustState(remoteState, localState);
        } else {
            // 信心分数相等时，使用时间戳较新的状态
            if (localTimestamp >= remoteTimestamp) {
                this._log('信心相等，使用时间戳较新的本地状态');
                return this._adjustState(localState, remoteState);
            } else {
                this._log('信心相等，使用时间戳较新的远程状态');
                return this._adjustState(remoteState, localState);
            }
        }
    }

    /**
     * 使用CRDT（无冲突复制数据类型）方法解决特定游戏属性的冲突
     * @param {Object} localState - 本地状态
     * @param {Object} remoteState - 远程状态
     * @param {string} propertyPath - 属性路径，如 "player.health"
     * @returns {*} 解决后的属性值
     */
    resolveProperty(localState, remoteState, propertyPath) {
        const localValue = this._getNestedProperty(localState, propertyPath);
        const remoteValue = this._getNestedProperty(remoteState, propertyPath);
        
        // 如果值相同，无需解决
        if (this._valuesEqual(localValue, remoteValue)) {
            return localValue;
        }

        // 根据属性类型选择合适的解决策略
        // 1. 数字类型（如生命值、能量）- 采用平均值或最大值策略
        if (typeof localValue === 'number' && typeof remoteValue === 'number') {
            // 对于生命值等不应增加的属性，取较小值（更安全的选择）
            if (propertyPath.includes('health') || propertyPath.includes('hp')) {
                return Math.min(localValue, remoteValue);
            }
            // 对于分数等累加属性，取较大值
            else if (propertyPath.includes('score') || propertyPath.includes('exp')) {
                return Math.max(localValue, remoteValue);
            }
            // 其他数值取平均值
            return Math.round((localValue + remoteValue) / 2);
        }
        
        // 2. 字符串类型 - 取较长或字典序较大的
        else if (typeof localValue === 'string' && typeof remoteValue === 'string') {
            return localValue.length >= remoteValue.length ? localValue : remoteValue;
        }
        
        // 3. 布尔类型 - 使用本地值（减少切换）
        else if (typeof localValue === 'boolean' && typeof remoteValue === 'boolean') {
            return localValue;
        }
        
        // 4. 数组类型 - 合并并去重
        else if (Array.isArray(localValue) && Array.isArray(remoteValue)) {
            // 创建一个合并后的数组
            const merged = [...localValue];
            // 添加远程数组中不存在的元素
            remoteValue.forEach(item => {
                if (!merged.some(localItem => this._valuesEqual(localItem, item))) {
                    merged.push(item);
                }
            });
            return merged;
        }
        
        // 5. 对象类型 - 深度合并
        else if (typeof localValue === 'object' && typeof remoteValue === 'object' && 
                 localValue !== null && remoteValue !== null) {
            const result = { ...localValue };
            // 合并远程对象的属性
            for (const key in remoteValue) {
                if (remoteValue.hasOwnProperty(key)) {
                    // 递归解决嵌套属性
                    result[key] = this.resolveProperty(
                        { [key]: localValue[key] || {} },
                        { [key]: remoteValue[key] },
                        key
                    );
                }
            }
            return result;
        }
        
        // 默认情况 - 使用本地值
        return localValue;
    }

    /**
     * 从历史记录重建状态（用于严重不同步的情况）
     * @param {string} playerId - 玩家ID
     * @param {number} targetTimestamp - 目标时间戳
     * @returns {Object|null} 重建的状态
     */
    reconstructStateFromHistory(playerId, targetTimestamp) {
        if (!this.stateHistory.has(playerId)) {
            return null;
        }

        const history = this.stateHistory.get(playerId);
        
        // 如果历史记录为空，返回null
        if (history.length === 0) {
            return null;
        }

        // 按时间戳排序
        const sortedHistory = [...history].sort((a, b) => a.timestamp - b.timestamp);

        // 找到最接近目标时间戳的状态
        let closestState = sortedHistory[0];
        let minTimeDiff = Math.abs(targetTimestamp - closestState.timestamp);

        for (let i = 1; i < sortedHistory.length; i++) {
            const timeDiff = Math.abs(targetTimestamp - sortedHistory[i].timestamp);
            if (timeDiff < minTimeDiff) {
                minTimeDiff = timeDiff;
                closestState = sortedHistory[i];
            }
        }

        this._log(`从历史重建状态，目标时间: ${targetTimestamp}, 实际时间: ${closestState.timestamp}`);
        return closestState.state;
    }

    /**
     * 检测两个状态是否发生严重不同步
     * @param {Object} state1 - 第一个状态
     * @param {Object} state2 - 第二个状态
     * @returns {boolean} 是否严重不同步
     */
    isSignificantlyDesynchronized(state1, state2) {
        // 基于关键属性的差异判断
        const criticalProperties = ['health', 'position', 'actionPoints'];
        let significantDifferences = 0;

        for (const prop of criticalProperties) {
            const val1 = this._getNestedProperty(state1, prop);
            const val2 = this._getNestedProperty(state2, prop);

            if (val1 !== undefined && val2 !== undefined) {
                // 对于数字类型，使用相对差异
                if (typeof val1 === 'number' && typeof val2 === 'number' && val1 !== 0 && val2 !== 0) {
                    const relativeDiff = Math.abs(val1 - val2) / Math.max(Math.abs(val1), Math.abs(val2));
                    if (relativeDiff > 0.5) { // 50% 以上的差异
                        significantDifferences++;
                    }
                }
                // 对于其他类型，检查是否完全不同
                else if (!this._valuesEqual(val1, val2)) {
                    significantDifferences++;
                }
            }
        }

        // 如果超过一半的关键属性存在显著差异，则认为严重不同步
        return significantDifferences >= criticalProperties.length / 2;
    }

    /**
     * 重置冲突解决器状态
     */
    reset() {
        this.stateHistory.clear();
        this.actionLog = [];
        this.lastResolutionTime = 0;
        this._log('冲突解决器已重置');
    }

    /**
     * 计算状态的信心分数
     * @private
     */
    _calculateConfidence(state, isAuthoritative) {
        // 基础分数
        let confidence = 1.0;

        // 时间戳权重 - 较新的状态获得更高分数
        const age = Date.now() - (state.timestamp || 0);
        const timeConfidence = Math.exp(-age / 5000); // 5秒后信心下降到约1/3
        confidence *= timeConfidence;

        // 权威权重 - 房主或服务器状态获得更高分数
        if (isAuthoritative) {
            confidence *= this.options.authorityWeight;
        }

        // 一致性检查 - 如果状态包含一致性哈希，验证其有效性
        if (state.consistencyHash) {
            const calculatedHash = this._calculateStateHash(state);
            if (state.consistencyHash === calculatedHash) {
                confidence *= 1.2; // 一致性验证通过，增加信心
            } else {
                confidence *= 0.7; // 一致性验证失败，降低信心
            }
        }

        return Math.min(confidence, 1.0);
    }

    /**
     * 调整状态，结合两个状态的部分信息
     * @private
     */
    _adjustState(primaryState, secondaryState) {
        // 创建主要状态的深拷贝
        const result = this._deepClone(primaryState);

        // 合并一些可能需要保留的次要状态信息
        const propertiesToMerge = ['player.name', 'player.level', 'matchSettings'];

        for (const propPath of propertiesToMerge) {
            const secondaryValue = this._getNestedProperty(secondaryState, propPath);
            if (secondaryValue !== undefined) {
                this._setNestedProperty(result, propPath, secondaryValue);
            }
        }

        // 添加一致性哈希以帮助后续验证
        result.consistencyHash = this._calculateStateHash(result);
        result.resolvedAt = Date.now();

        return result;
    }

    /**
     * 计算状态的哈希值（用于一致性检查）
     * @private
     */
    _calculateStateHash(state) {
        // 创建不包含哈希值本身的状态副本
        const stateWithoutHash = { ...state };
        delete stateWithoutHash.consistencyHash;
        delete stateWithoutHash.resolvedAt;

        // 序列化并计算简单哈希
        const serialized = JSON.stringify(stateWithoutHash);
        let hash = 0;
        for (let i = 0; i < serialized.length; i++) {
            const char = serialized.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 转换为32位整数
        }
        return Math.abs(hash).toString(16);
    }

    /**
     * 获取嵌套属性值
     * @private
     */
    _getNestedProperty(obj, path) {
        if (!obj || typeof obj !== 'object') return undefined;
        
        const properties = path.split('.');
        let value = obj;

        for (const prop of properties) {
            if (value === null || value === undefined || !value.hasOwnProperty(prop)) {
                return undefined;
            }
            value = value[prop];
        }

        return value;
    }

    /**
     * 设置嵌套属性值
     * @private
     */
    _setNestedProperty(obj, path, value) {
        if (!obj || typeof obj !== 'object') return;
        
        const properties = path.split('.');
        let current = obj;

        for (let i = 0; i < properties.length - 1; i++) {
            const prop = properties[i];
            if (!current[prop] || typeof current[prop] !== 'object') {
                current[prop] = {};
            }
            current = current[prop];
        }

        current[properties[properties.length - 1]] = value;
    }

    /**
     * 深度克隆对象
     * @private
     */
    _deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj.getTime());
        if (obj instanceof Array) return obj.map(item => this._deepClone(item));
        
        const clonedObj = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                clonedObj[key] = this._deepClone(obj[key]);
            }
        }
        return clonedObj;
    }

    /**
     * 比较两个值是否相等（支持嵌套对象）
     * @private
     */
    _valuesEqual(a, b) {
        if (a === b) return true;
        
        if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
            return false;
        }
        
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);
        
        if (aKeys.length !== bKeys.length) return false;
        
        for (const key of aKeys) {
            if (!b.hasOwnProperty(key) || !this._valuesEqual(a[key], b[key])) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * 日志记录
     * @private
     */
    _log(message) {
        if (this.options.debug) {
            console.log(`[DOL-PVP-RESOLVER] ${message}`);
        }
    }
}

// 导出模块
export default ConflictResolver;