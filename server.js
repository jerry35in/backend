// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // 允许所有来源（部署后可限制为你的 GitHub Pages 域名）
    methods: ["GET", "POST"]
  }
});

console.log("WebSocket 服务器启动中...");

// 存储房间信息（简易内存存储）
const rooms = {};

io.on('connection', (socket) => {
  console.log('新用户连接:', socket.id);

  // 加入房间
  socket.on('join-room', ({ roomId, username }) => {
    socket.join(roomId);
    socket.data = { roomId, username };

    if (!rooms[roomId]) {
      rooms[roomId] = { players: [] };
    }

    // 防止重复加入
    const existing = rooms[roomId].players.find(p => p.id === socket.id);
    if (!existing) {
      rooms[roomId].playerCount = rooms[roomId].players.push({ id: socket.id, username });
    }

    // 广播：有人加入
    io.to(roomId).emit('player-joined', { id: socket.id, username, total: rooms[roomId].players.length });

    console.log(`用户 ${username} 加入房间 ${roomId}`);
  });

  // 提交答案
  socket.on('submit-answer', ({ answer, questionIndex }) => {
    const { roomId, username } = socket.data || {};
    if (!roomId) return;

    // 通知同房间其他人
    socket.to(roomId).emit('opponent-answered', {
      username,
      answer,
      questionIndex,
      time: Date.now()
    });

    console.log(`${username} 在房间 ${roomId} 提交了答案`);
  });

  // 断开连接
  socket.on('disconnect', () => {
    console.log('用户断开:', socket.id);
    // （可选）清理房间逻辑
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ 服务器运行在端口 ${PORT}`);
});