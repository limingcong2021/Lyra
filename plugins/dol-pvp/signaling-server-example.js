/**
 * DoL联机单挑插件 - 信令服务器示例
 * 这是一个基于Node.js和ws库的简单WebSocket信令服务器示例
 * 用于处理WebRTC连接的初始握手和信令交换
 * 
 * 使用方法：
 * 1. 安装依赖: npm install ws
 * 2. 运行服务器: node signaling-server-example.js
 * 
 * 注意：这只是一个示例实现，生产环境应考虑安全性、可扩展性和错误处理
 */

// 导入WebSocket库
const WebSocket = require('ws');
const http = require('http');
const url = require('url');

// 服务器配置
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// 创建HTTP服务器（用于支持WebSocket）
const server = http.createServer((req, res) => {
    // 设置CORS头，允许所有来源
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // 处理预检请求
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }
    
    // 简单的状态页面
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <html>
            <head><title>DoL PVP Signaling Server</title></head>
            <body>
                <h1>DoL PVP 信令服务器运行中</h1>
                <p>端口: ${PORT}</p>
                <p>支持WebSocket连接</p>
            </body>
            </html>
        `);
    } else {
        res.writeHead(404);
        res.end();
    }
});

// 创建WebSocket服务器，附加到HTTP服务器
const wss = new WebSocket.Server({ noServer: true });

// 房间管理
const rooms = new Map(); // roomId -> { owner, players[], createdAt }
const clients = new Map(); // clientId -> { ws, roomId, playerId, playerInfo }

// 生成唯一ID
function generateId() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
}

// 处理WebSocket连接升级
server.on('upgrade', (request, socket, head) => {
    // 验证路径
    const pathname = url.parse(request.url).pathname;
    if (pathname === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
    }
});

// 处理新的WebSocket连接
wss.on('connection', (ws, request) => {
    const clientId = generateId();
    
    // 存储客户端信息
    clients.set(clientId, {
        ws: ws,
        roomId: null,
        playerId: null,
        playerInfo: {
            id: clientId,
            name: `Player_${clientId.substring(0, 6)}`,
            connectedAt: Date.now()
        }
    });

    console.log(`新连接: ${clientId}`);
    
    // 发送连接确认
    sendToClient(clientId, {
        type: 'CONNECTED',
        clientId: clientId,
        message: '已连接到信令服务器'
    });

    // 处理接收到的消息
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleClientMessage(clientId, data);
        } catch (error) {
            console.error(`消息解析错误: ${error.message}`);
            sendToClient(clientId, {
                type: 'ERROR',
                message: '无效的消息格式'
            });
        }
    });

    // 处理连接关闭
    ws.on('close', () => {
        handleClientDisconnect(clientId);
    });

    // 处理错误
    ws.on('error', (error) => {
        console.error(`客户端错误 [${clientId}]: ${error.message}`);
    });
});

// 处理客户端消息
function handleClientMessage(clientId, message) {
    const client = clients.get(clientId);
    if (!client) return;

    console.log(`收到消息 [${clientId}]: ${message.type}`);

    switch (message.type) {
        case 'CREATE_ROOM':
            handleCreateRoom(clientId, message.config || {});
            break;
        
        case 'JOIN_ROOM':
            handleJoinRoom(clientId, message.roomId);
            break;
        
        case 'LEAVE_ROOM':
            handleLeaveRoom(clientId);
            break;
        
        case 'SDP_OFFER':
            handleSdpOffer(clientId, message.target, message.offer);
            break;
        
        case 'SDP_ANSWER':
            handleSdpAnswer(clientId, message.target, message.answer);
            break;
        
        case 'ICE_CANDIDATE':
            handleIceCandidate(clientId, message.target, message.candidate);
            break;
        
        case 'UPDATE_PLAYER_INFO':
            handleUpdatePlayerInfo(clientId, message.info);
            break;
        
        default:
            console.log(`未知消息类型: ${message.type}`);
            sendToClient(clientId, {
                type: 'ERROR',
                message: `未知的消息类型: ${message.type}`
            });
    }
}

// 处理创建房间
function handleCreateRoom(clientId, config) {
    const client = clients.get(clientId);
    if (!client) return;

    // 如果已经在房间中，先离开
    if (client.roomId) {
        handleLeaveRoom(clientId);
    }

    // 创建新房间
    const roomId = generateId().substring(0, 8); // 使用较短的ID作为房间号
    const room = {
        id: roomId,
        owner: clientId,
        players: [clientId],
        config: config,
        createdAt: Date.now()
    };

    rooms.set(roomId, room);
    client.roomId = roomId;
    client.playerId = clientId; // 使用clientId作为playerId

    console.log(`创建房间: ${roomId} (房主: ${clientId})`);

    // 发送房间创建成功消息
    sendToClient(clientId, {
        type: 'ROOM_CREATED',
        roomId: roomId,
        playerId: client.playerId
    });

    // 定期清理过期房间（可选）
    setTimeout(() => {
        cleanupInactiveRooms();
    }, 60000); // 每分钟检查一次
}

// 处理加入房间
function handleJoinRoom(clientId, roomId) {
    const client = clients.get(clientId);
    if (!client) return;

    // 如果已经在房间中，先离开
    if (client.roomId) {
        handleLeaveRoom(clientId);
    }

    // 检查房间是否存在
    const room = rooms.get(roomId);
    if (!room) {
        sendToClient(clientId, {
            type: 'ERROR',
            message: '房间不存在'
        });
        return;
    }

    // 检查房间是否已满（最多2人）
    if (room.players.length >= 2) {
        sendToClient(clientId, {
            type: 'ERROR',
            message: '房间已满'
        });
        return;
    }

    // 加入房间
    room.players.push(clientId);
    client.roomId = roomId;
    client.playerId = clientId;

    console.log(`玩家 ${clientId} 加入房间 ${roomId}`);

    // 发送加入成功消息给新玩家
    sendToClient(clientId, {
        type: 'ROOM_JOINED',
        roomId: roomId,
        playerId: client.playerId,
        isJoiner: true // 标记为加入者
    });

    // 通知房间中的其他玩家有新玩家加入
    const otherPlayerId = room.players.find(id => id !== clientId);
    if (otherPlayerId) {
        sendToClient(otherPlayerId, {
            type: 'PLAYER_CONNECTED',
            player: {
                id: client.playerId,
                name: client.playerInfo.name
            },
            isJoiner: true
        });

        // 同时告诉新玩家其他玩家的信息
        const otherPlayer = clients.get(otherPlayerId);
        if (otherPlayer) {
            sendToClient(clientId, {
                type: 'PLAYER_CONNECTED',
                player: {
                    id: otherPlayer.playerId,
                    name: otherPlayer.playerInfo.name
                },
                otherPlayerId: otherPlayerId
            });
        }
    }
}

// 处理离开房间
function handleLeaveRoom(clientId) {
    const client = clients.get(clientId);
    if (!client || !client.roomId) return;

    const roomId = client.roomId;
    const room = rooms.get(roomId);

    if (room) {
        // 从房间中移除玩家
        room.players = room.players.filter(id => id !== clientId);

        // 通知房间中的其他玩家
        room.players.forEach(playerId => {
            sendToClient(playerId, {
                type: 'PLAYER_DISCONNECTED',
                playerId: clientId
            });
        });

        // 如果房间为空，删除房间
        if (room.players.length === 0) {
            rooms.delete(roomId);
            console.log(`删除空房间: ${roomId}`);
        } else if (clientId === room.owner) {
            // 如果离开的是房主，转移房主权限
            room.owner = room.players[0];
            console.log(`转移房间 ${roomId} 房主权限给 ${room.owner}`);
        }
    }

    // 清除客户端房间信息
    client.roomId = null;
    client.playerId = null;

    console.log(`玩家 ${clientId} 离开房间 ${roomId}`);
}

// 处理客户端断开连接
function handleClientDisconnect(clientId) {
    console.log(`客户端断开连接: ${clientId}`);

    // 自动离开房间
    handleLeaveRoom(clientId);

    // 清理客户端信息
    clients.delete(clientId);
}

// 处理SDP提议
function handleSdpOffer(fromId, targetId, offer) {
    const targetClient = clients.get(targetId);
    if (!targetClient || targetClient.roomId !== clients.get(fromId).roomId) {
        sendToClient(fromId, {
            type: 'ERROR',
            message: '目标玩家不存在或不在同一房间'
        });
        return;
    }

    sendToClient(targetId, {
        type: 'SDP_OFFER',
        from: fromId,
        offer: offer
    });
}

// 处理SDP应答
function handleSdpAnswer(fromId, targetId, answer) {
    const targetClient = clients.get(targetId);
    if (!targetClient || targetClient.roomId !== clients.get(fromId).roomId) {
        sendToClient(fromId, {
            type: 'ERROR',
            message: '目标玩家不存在或不在同一房间'
        });
        return;
    }

    sendToClient(targetId, {
        type: 'SDP_ANSWER',
        from: fromId,
        answer: answer
    });
}

// 处理ICE候选者
function handleIceCandidate(fromId, targetId, candidate) {
    const targetClient = clients.get(targetId);
    if (!targetClient || targetClient.roomId !== clients.get(fromId).roomId) {
        // 不发送错误消息，因为ICE候选者可能在玩家离开后仍在传输
        return;
    }

    sendToClient(targetId, {
        type: 'ICE_CANDIDATE',
        from: fromId,
        candidate: candidate
    });
}

// 处理玩家信息更新
function handleUpdatePlayerInfo(clientId, info) {
    const client = clients.get(clientId);
    if (!client) return;

    // 更新玩家信息
    client.playerInfo = {
        ...client.playerInfo,
        ...info,
        id: client.playerInfo.id // 保留原始ID
    };

    // 如果玩家在房间中，通知其他玩家
    if (client.roomId) {
        const room = rooms.get(client.roomId);
        if (room) {
            room.players.forEach(playerId => {
                if (playerId !== clientId) {
                    sendToClient(playerId, {
                        type: 'PLAYER_INFO_UPDATED',
                        player: {
                            id: client.playerId,
                            name: client.playerInfo.name
                        }
                    });
                }
            });
        }
    }

    // 确认更新成功
    sendToClient(clientId, {
        type: 'PLAYER_INFO_UPDATED',
        success: true
    });
}

// 发送消息到客户端
function sendToClient(clientId, message) {
    const client = clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
        try {
            client.ws.send(JSON.stringify(message));
        } catch (error) {
            console.error(`发送消息失败 [${clientId}]: ${error.message}`);
        }
    }
}

// 清理不活跃的房间
function cleanupInactiveRooms() {
    const now = Date.now();
    const timeout = 30 * 60 * 1000; // 30分钟超时

    rooms.forEach((room, roomId) => {
        if (now - room.createdAt > timeout && room.players.length === 0) {
            rooms.delete(roomId);
            console.log(`清理过期房间: ${roomId}`);
        }
    });
}

// 启动服务器
server.listen(PORT, HOST, () => {
    console.log(`信令服务器启动在 http://${HOST}:${PORT}`);
    console.log(`WebSocket端点: ws://${HOST}:${PORT}/ws`);
});

// 处理进程终止
process.on('SIGINT', () => {
    console.log('正在关闭服务器...');
    
    // 向所有客户端发送关闭消息
    clients.forEach((client, clientId) => {
        sendToClient(clientId, {
            type: 'SERVER_SHUTTING_DOWN',
            message: '服务器即将关闭'
        });
        client.ws.close();
    });
    
    // 关闭HTTP服务器
    server.close(() => {
        console.log('服务器已关闭');
        process.exit(0);
    });
});

// 错误处理
process.on('uncaughtException', (error) => {
    console.error('未捕获的异常:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('未处理的Promise拒绝:', reason);
});