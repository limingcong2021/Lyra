/**
 * DoL联机单挑插件 - 网络Worker模块
 * 负责在后台处理网络通信、信令交换和状态同步，避免阻塞主线程
 */

// Worker环境中的全局变量
let config = null;
let socket = null;
let roomId = null;
let playerId = null;
let isConnected = false;
let reconnectAttempts = 0;
let reconnectTimeout = null;
let pendingMessages = [];
let peerConnections = new Map();
let dataChannels = new Map();
let iceCandidates = new Map();
let stateQueue = [];
let lastStateSentTime = 0;

// WebRTC配置
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// 事件处理器 - 接收来自主线程的消息
self.onmessage = function(event) {
    const { type, config: newConfig, roomConfig, roomId: targetRoomId, action, state, location, playerId, requestId, targetPlayerId, playerInfo, inviteOnly, inviteeId, requesterId } = event.data;

    switch (type) {
        case 'INIT':
            handleInit(newConfig);
            break;
        
        case 'CREATE_ROOM':
            handleCreateRoom(roomConfig);
            break;
        
        case 'JOIN_ROOM':
            handleJoinRoom(targetRoomId);
            break;
        
        case 'LEAVE_ROOM':
            handleLeaveRoom();
            break;
        
        case 'SEND_ACTION':
            handleSendAction(action);
            break;
        
        case 'SYNC_STATE':
            handleSyncState(state);
            break;
        
        case 'UPDATE_LOCATION':
            handleUpdateLocation(location, playerId);
            break;
            
        case 'SEND_COMBAT_REQUEST':
            handleSendCombatRequest(requestId, targetPlayerId, playerInfo, location);
            break;
            
        case 'ACCEPT_COMBAT_REQUEST':
            handleAcceptCombatRequest(requestId, requesterId, targetRoomId);
            break;
            
        case 'REJECT_COMBAT_REQUEST':
            handleRejectCombatRequest(requestId, requesterId);
            break;
        
        default:
            log(`未知消息类型: ${type}`);
    }
};

/**
 * 初始化网络Worker
 */
function handleInit(newConfig) {
    config = newConfig;
    log('网络Worker已初始化');
    connectToSignalingServer();
}

/**
 * 连接到信令服务器
 */
function connectToSignalingServer() {
    if (!config.serverUrl) {
        sendError('未配置信令服务器URL');
        return;
    }

    try {
        // 创建WebSocket连接
        socket = new WebSocket(config.serverUrl);
        
        socket.onopen = handleSocketOpen;
        socket.onmessage = handleSocketMessage;
        socket.onclose = handleSocketClose;
        socket.onerror = handleSocketError;
    } catch (error) {
        sendError(`连接信令服务器失败: ${error.message}`);
        attemptReconnect();
    }
}

/**
 * 处理WebSocket连接打开
 */
function handleSocketOpen() {
    log('已连接到信令服务器');
    isConnected = true;
    reconnectAttempts = 0;
    
    // 发送队列中的待处理消息
    while (pendingMessages.length > 0) {
        const message = pendingMessages.shift();
        sendToSignalingServer(message);
    }
}

/**
 * 处理WebSocket接收到的消息
 */
function handleSocketMessage(event) {
    try {
        const message = JSON.parse(event.data);
        handleSignalingMessage(message);
    } catch (error) {
        log(`解析信令消息失败: ${error.message}`, true);
    }
}

/**
 * 处理WebSocket连接关闭
 */
function handleSocketClose(event) {
    log(`信令服务器连接已关闭: ${event.code} - ${event.reason}`);
    isConnected = false;
    
    // 清理WebRTC连接
    cleanupPeerConnections();
    
    // 尝试重新连接
    if (config.autoReconnect) {
        attemptReconnect();
    }
}

/**
 * 处理WebSocket错误
 */
function handleSocketError(error) {
    log(`信令服务器连接错误: ${error.message}`, true);
    sendError(`网络错误: ${error.message}`);
}

/**
 * 尝试重新连接
 */
function attemptReconnect() {
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }
    
    // 指数退避算法
    const maxAttempts = 5;
    if (reconnectAttempts >= maxAttempts) {
        sendError(`达到最大重连次数 (${maxAttempts})`);
        return;
    }
    
    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000); // 最大30秒
    
    log(`将在 ${delay}ms 后尝试重新连接 (第 ${reconnectAttempts} 次尝试)`);
    
    reconnectTimeout = setTimeout(() => {
        connectToSignalingServer();
    }, delay);
}

/**
 * 创建新的PVP房间
 */
function handleCreateRoom(roomConfig = {}) {
    if (!isConnected) {
        sendError('未连接到服务器');
        return;
    }
    
    sendToSignalingServer({
        type: 'CREATE_ROOM',
        config: roomConfig
    });
}

/**
 * 加入现有房间
 */
function handleJoinRoom(targetRoomId) {
    if (!isConnected) {
        sendError('未连接到服务器');
        return;
    }
    
    sendToSignalingServer({
        type: 'JOIN_ROOM',
        roomId: targetRoomId
    });
}

/**
 * 离开当前房间
 */
function handleLeaveRoom() {
    if (!isConnected || !roomId) {
        return;
    }
    
    sendToSignalingServer({
        type: 'LEAVE_ROOM',
        roomId: roomId
    });
    
    // 清理
    roomId = null;
    playerId = null;
    cleanupPeerConnections();
}

/**
 * 发送游戏动作
 */
function handleSendAction(action) {
    // 通过WebRTC数据通道发送动作
    dataChannels.forEach(channel => {
        if (channel.readyState === 'open') {
            channel.send(JSON.stringify({
                type: 'ACTION',
                action: action
            }));
        }
    });
}

/**
 * 同步游戏状态
 */
function handleSyncState(state) {
    // 限制状态发送频率
    const now = Date.now();
    if (now - lastStateSentTime < config.syncInterval) {
        // 将状态加入队列，稍后批量发送
        stateQueue.push(state);
        return;
    }
    
    // 发送当前状态和队列中的状态
    const statesToSend = [state, ...stateQueue];
    stateQueue = [];
    lastStateSentTime = now;
    
    dataChannels.forEach(channel => {
        if (channel.readyState === 'open') {
            channel.send(JSON.stringify({
                type: 'SYNC_STATE',
                states: statesToSend
            }));
        }
    });
}

/**
 * 更新玩家位置
 */
function handleUpdateLocation(location, playerId) {
    if (!isConnected) {
        return;
    }
    
    sendToSignalingServer({
        type: 'UPDATE_LOCATION',
        playerId: playerId,
        location: location
    });
}

/**
 * 发送战斗请求
 */
function handleSendCombatRequest(requestId, targetPlayerId, playerInfo, location) {
    if (!isConnected) {
        sendError('未连接到服务器');
        return;
    }
    
    sendToSignalingServer({
        type: 'SEND_COMBAT_REQUEST',
        requestId: requestId,
        senderId: playerId,
        targetPlayerId: targetPlayerId,
        playerInfo: playerInfo,
        location: location
    });
}

/**
 * 接受战斗请求
 */
function handleAcceptCombatRequest(requestId, requesterId, targetRoomId) {
    if (!isConnected) {
        sendError('未连接到服务器');
        return;
    }
    
    sendToSignalingServer({
        type: 'ACCEPT_COMBAT_REQUEST',
        requestId: requestId,
        receiverId: playerId,
        requesterId: requesterId,
        roomId: targetRoomId
    });
}

/**
 * 拒绝战斗请求
 */
function handleRejectCombatRequest(requestId, requesterId) {
    if (!isConnected) {
        sendError('未连接到服务器');
        return;
    }
    
    sendToSignalingServer({
        type: 'REJECT_COMBAT_REQUEST',
        requestId: requestId,
        receiverId: playerId,
        requesterId: requesterId
    });
}

/**
 * 处理来自信令服务器的消息
 */
function handleSignalingMessage(message) {
    const { type } = message;
    
    switch (type) {
        case 'ROOM_CREATED':
            // 房间创建成功
            roomId = message.roomId;
            playerId = message.playerId;
            sendToMainThread({
                type: 'ROOM_CREATED',
                data: { roomId, playerId }
            });
            break;
            
        case 'ROOM_JOINED':
            // 成功加入房间
            roomId = message.roomId;
            playerId = message.playerId;
            sendToMainThread({
                type: 'ROOM_JOINED',
                data: { roomId, playerId }
            });
            
            // 如果是第二个玩家（加入者），主动发起WebRTC连接
            if (message.isJoiner) {
                setupPeerConnection(message.otherPlayerId, true);
            }
            break;
            
        case 'PLAYER_CONNECTED':
            // 有其他玩家连接到房间
            const player = message.player;
            sendToMainThread({
                type: 'PLAYER_CONNECTED',
                data: { player }
            });
            
            // 如果是房主，需要接受连接并创建WebRTC连接
            if (!message.isJoiner) {
                setupPeerConnection(player.id, false);
            }
            break;
            
        case 'PLAYER_DISCONNECTED':
            // 其他玩家断开连接
            const playerId = message.playerId;
            sendToMainThread({
                type: 'PLAYER_DISCONNECTED',
                data: { playerId }
            });
            
            // 清理相关的WebRTC连接
            cleanupPeerConnection(playerId);
            break;
            
        case 'SDP_OFFER':
            // 收到SDP提议
            handleSdpOffer(message.from, message.offer);
            break;
            
        case 'SDP_ANSWER':
            // 收到SDP应答
            handleSdpAnswer(message.from, message.answer);
            break;
            
        case 'ICE_CANDIDATE':
            // 收到ICE候选者
            handleIceCandidate(message.from, message.candidate);
            break;
            
        case 'ERROR':
            // 收到错误消息
            sendError(message.message);
            break;
            
        case 'COMBAT_REQUEST_RECEIVED':
            // 收到战斗请求
            sendToMainThread({
                type: 'COMBAT_REQUEST_RECEIVED',
                data: {
                    requestId: message.requestId,
                    requesterId: message.requesterId,
                    playerInfo: message.playerInfo,
                    location: message.location
                }
            });
            break;
            
        case 'COMBAT_REQUEST_ACCEPTED':
            // 战斗请求被接受
            sendToMainThread({
                type: 'COMBAT_REQUEST_ACCEPTED',
                data: {
                    requestId: message.requestId,
                    roomId: message.roomId
                }
            });
            break;
            
        case 'COMBAT_REQUEST_REJECTED':
            // 战斗请求被拒绝
            sendToMainThread({
                type: 'COMBAT_REQUEST_REJECTED',
                data: {
                    requestId: message.requestId
                }
            });
            break;
            
        case 'PLAYERS_IN_SAME_LOCATION':
            // 检测到同一位置的玩家
            sendToMainThread({
                type: 'PLAYERS_IN_SAME_LOCATION',
                data: {
                    players: message.players
                }
            });
            break;
            
        default:
            log(`未知信令消息类型: ${type}`);
    }
}

/**
 * 设置WebRTC对等连接
 */
function setupPeerConnection(remotePlayerId, isInitiator) {
    try {
        const pc = new RTCPeerConnection(rtcConfig);
        peerConnections.set(remotePlayerId, pc);
        
        // 设置ICE候选者处理
        pc.onicecandidate = event => {
            if (event.candidate) {
                sendToSignalingServer({
                    type: 'ICE_CANDIDATE',
                    target: remotePlayerId,
                    candidate: event.candidate
                });
            }
        };
        
        // 处理ICE连接状态变化
        pc.oniceconnectionstatechange = () => {
            log(`ICE连接状态: ${pc.iceConnectionState}`);
            
            if (pc.iceConnectionState === 'failed' || 
                pc.iceConnectionState === 'disconnected') {
                cleanupPeerConnection(remotePlayerId);
                sendToMainThread({
                    type: 'PLAYER_DISCONNECTED',
                    data: { playerId: remotePlayerId }
                });
            }
        };
        
        // 创建数据通道（仅由发起者创建）
        if (isInitiator) {
            const dataChannel = pc.createDataChannel('game-data');
            setupDataChannel(remotePlayerId, dataChannel);
        } else {
            // 监听数据通道创建
            pc.ondatachannel = event => {
                setupDataChannel(remotePlayerId, event.channel);
            };
        }
        
        // 如果是发起者，创建并发送SDP提议
        if (isInitiator) {
            createAndSendOffer(remotePlayerId, pc);
        }
        
        // 处理存储的ICE候选者
        if (iceCandidates.has(remotePlayerId)) {
            iceCandidates.get(remotePlayerId).forEach(candidate => {
                pc.addIceCandidate(new RTCIceCandidate(candidate))
                    .catch(error => log(`添加ICE候选者失败: ${error.message}`, true));
            });
            iceCandidates.delete(remotePlayerId);
        }
        
    } catch (error) {
        log(`设置WebRTC连接失败: ${error.message}`, true);
        sendError(`P2P连接建立失败`);
    }
}

/**
 * 设置数据通道
 */
function setupDataChannel(remotePlayerId, dataChannel) {
    dataChannels.set(remotePlayerId, dataChannel);
    
    // 处理接收到的数据
    dataChannel.onmessage = event => {
        try {
            const message = JSON.parse(event.data);
            handleDataChannelMessage(remotePlayerId, message);
        } catch (error) {
            log(`解析数据通道消息失败: ${error.message}`, true);
        }
    };
    
    // 处理数据通道状态变化
    dataChannel.onopen = () => {
        log(`数据通道已打开 (与玩家 ${remotePlayerId})`);
    };
    
    dataChannel.onclose = () => {
        log(`数据通道已关闭 (与玩家 ${remotePlayerId})`);
        cleanupPeerConnection(remotePlayerId);
    };
    
    dataChannel.onerror = error => {
        log(`数据通道错误: ${error.message}`, true);
    };
}

/**
 * 创建并发送SDP提议
 */
async function createAndSendOffer(remotePlayerId, pc) {
    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        sendToSignalingServer({
            type: 'SDP_OFFER',
            target: remotePlayerId,
            offer: offer
        });
    } catch (error) {
        log(`创建SDP提议失败: ${error.message}`, true);
    }
}

/**
 * 处理SDP提议
 */
async function handleSdpOffer(from, offer) {
    const pc = peerConnections.get(from);
    if (!pc) {
        setupPeerConnection(from, false);
    }
    
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        sendToSignalingServer({
            type: 'SDP_ANSWER',
            target: from,
            answer: answer
        });
    } catch (error) {
        log(`处理SDP提议失败: ${error.message}`, true);
    }
}

/**
 * 处理SDP应答
 */
async function handleSdpAnswer(from, answer) {
    const pc = peerConnections.get(from);
    if (!pc) {
        log(`没有找到对应的对等连接: ${from}`);
        return;
    }
    
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
        log(`处理SDP应答失败: ${error.message}`, true);
    }
}

/**
 * 处理ICE候选者
 */
async function handleIceCandidate(from, candidate) {
    const pc = peerConnections.get(from);
    if (pc) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
            log(`添加ICE候选者失败: ${error.message}`, true);
        }
    } else {
        // 如果连接尚未建立，存储候选者
        if (!iceCandidates.has(from)) {
            iceCandidates.set(from, []);
        }
        iceCandidates.get(from).push(candidate);
    }
}

/**
 * 处理数据通道消息
 */
function handleDataChannelMessage(from, message) {
    const { type } = message;
    
    switch (type) {
        case 'ACTION':
            // 转发动作到主线程
            sendToMainThread({
                type: 'ACTION_RECEIVED',
                data: { action: message.action }
            });
            break;
            
        case 'SYNC_STATE':
            // 处理批量状态同步
            if (Array.isArray(message.states)) {
                message.states.forEach(state => {
                    sendToMainThread({
                        type: 'STATE_RECEIVED',
                        data: { state: state }
                    });
                });
            }
            break;
            
        case 'COMBAT_END':
            // 处理战斗结束消息
            sendToMainThread({
                type: 'ACTION_RECEIVED',
                data: { action: message }
            });
            break;
            
        default:
            log(`未知数据通道消息类型: ${type}`);
    }
}

/**
 * 发送消息到信令服务器
 */
function sendToSignalingServer(message) {
    if (isConnected && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
    } else {
        // 连接未建立，将消息加入队列
        pendingMessages.push(message);
    }
}

/**
 * 发送消息到主线程
 */
function sendToMainThread(message) {
    self.postMessage(message);
}

/**
 * 发送错误消息到主线程
 */
function sendError(message) {
    sendToMainThread({
        type: 'ERROR',
        data: { message }
    });
}

/**
 * 清理特定的对等连接
 */
function cleanupPeerConnection(remotePlayerId) {
    if (peerConnections.has(remotePlayerId)) {
        const pc = peerConnections.get(remotePlayerId);
        pc.close();
        peerConnections.delete(remotePlayerId);
    }
    
    if (dataChannels.has(remotePlayerId)) {
        const channel = dataChannels.get(remotePlayerId);
        if (channel.readyState === 'open') {
            channel.close();
        }
        dataChannels.delete(remotePlayerId);
    }
    
    if (iceCandidates.has(remotePlayerId)) {
        iceCandidates.delete(remotePlayerId);
    }
}

/**
 * 清理所有对等连接
 */
function cleanupPeerConnections() {
    peerConnections.forEach((pc, playerId) => {
        cleanupPeerConnection(playerId);
    });
}

/**
 * 日志记录函数
 */
function log(message, isError = false) {
    if (config && config.debug || isError) {
        const prefix = '[DOL-PVP-WORKER]';
        if (isError) {
            console.error(`${prefix} ${message}`);
        } else {
            console.log(`${prefix} ${message}`);
        }
    }
}

// 监听Worker终止事件
self.onclose = function() {
    log('网络Worker正在终止');
    cleanupPeerConnections();
    if (socket) {
        socket.close();
    }
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }
};