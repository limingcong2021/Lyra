/**
 * Cloudflare Worker 信令服务器实现
 * 用于DoL-Lyra PVP插件的WebRTC信令服务
 */

// 存储房间和对等连接信息
const rooms = new Map();

// 响应CORS请求
const handleCors = (request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };

  // 处理预检请求
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders,
    });
  }

  return corsHeaders;
};

// 创建新房间
const createRoom = (roomId, hostId) => {
  rooms.set(roomId, {
    hostId,
    clients: new Map(),
    createdAt: Date.now(),
  });
  return { success: true, roomId };
};

// 加入房间
const joinRoom = (roomId, clientId) => {
  const room = rooms.get(roomId);
  if (!room) {
    return { success: false, error: '房间不存在' };
  }

  room.clients.set(clientId, true);
  return { success: true, roomId, hostId: room.hostId };
};

// 离开房间
const leaveRoom = (roomId, clientId) => {
  const room = rooms.get(roomId);
  if (!room) {
    return { success: false, error: '房间不存在' };
  }

  // 检查是否是房主
  if (room.hostId === clientId) {
    // 房主离开，关闭整个房间
    rooms.delete(roomId);
    return { success: true, roomClosed: true };
  } else {
    // 普通客户端离开
    room.clients.delete(clientId);
    return { success: true, roomClosed: false };
  }
};

// 转发消息给目标客户端
const forwardMessage = (roomId, targetId, senderId, data) => {
  // 这个函数在实际部署中需要WebSocket支持
  // 由于Cloudflare Worker的限制，这里只返回成功状态
  return { success: true };
};

// 处理位置更新消息
const handleUpdateLocation = (roomId, userId, location) => {
  const room = rooms.get(roomId);
  if (!room) {
    return { success: false, error: '房间不存在' };
  }

  // 更新用户位置
  // 在实际部署中，这会涉及到更复杂的位置存储和查询逻辑
  return { success: true };
};

// 处理战斗请求
const handleSendCombatRequest = (roomId, senderId, targetId) => {
  const room = rooms.get(roomId);
  if (!room) {
    return { success: false, error: '房间不存在' };
  }

  // 检查目标是否在房间内
  if (!room.clients.has(targetId) && room.hostId !== targetId) {
    return { success: false, error: '目标用户不在房间内' };
  }

  return { success: true, message: '战斗请求已发送' };
};

// 清理过期房间
const cleanupExpiredRooms = () => {
  const now = Date.now();
  const maxRoomAge = 2 * 60 * 60 * 1000; // 2小时

  for (const [roomId, room] of rooms.entries()) {
    if (now - room.createdAt > maxRoomAge) {
      rooms.delete(roomId);
    }
  }
};

// 主处理函数
async function handleRequest(request) {
  try {
    // 清理过期房间
    cleanupExpiredRooms();
    
    // 处理CORS
    const corsHeaders = handleCors(request);
    
    // 只处理POST请求
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ success: false, error: '只支持POST请求' }),
        {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
          status: 405,
        }
      );
    }

    // 解析请求体
    const contentType = request.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return new Response(
        JSON.stringify({ success: false, error: '需要JSON格式的请求体' }),
        {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
          status: 400,
        }
      );
    }

    const body = await request.json();
    let responseData;

    // 根据action处理不同的请求
    switch (body.action) {
      case 'createRoom':
        responseData = createRoom(body.roomId, body.userId);
        break;
      case 'joinRoom':
        responseData = joinRoom(body.roomId, body.userId);
        break;
      case 'leaveRoom':
        responseData = leaveRoom(body.roomId, body.userId);
        break;
      case 'updateLocation':
        responseData = handleUpdateLocation(body.roomId, body.userId, body.location);
        break;
      case 'sendCombatRequest':
        responseData = handleSendCombatRequest(body.roomId, body.userId, body.targetId);
        break;
      case 'getRooms':
        // 获取房间列表（仅用于调试）
        const roomList = Array.from(rooms.keys()).map(id => ({
          roomId: id,
          clientCount: rooms.get(id).clients.size + 1, // 包括房主
          createdAt: rooms.get(id).createdAt
        }));
        responseData = { success: true, rooms: roomList };
        break;
      default:
        responseData = { success: false, error: '未知的操作类型' };
    }

    // 返回响应
    return new Response(JSON.stringify(responseData), {
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  } catch (error) {
    console.error('处理请求时出错:', error);
    const corsHeaders = handleCors(request);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: '服务器内部错误',
        message: error.message,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
        status: 500,
      }
    );
  }
}

// 导出处理函数，使用 ES 模块格式以兼容 Cloudflare Worker
// 注意：在直接使用 Node.js 运行时需要配置 "type": "module" 或使用 .mjs 扩展名
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request);
  },
};