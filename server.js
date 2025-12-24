// 服务器端依赖：需先安装 npm install express socket.io cors
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors()); // 解决跨域问题

// 创建HTTP服务器
const server = http.createServer(app);

// 配置Socket.IO，允许跨域
const io = new Server(server, {
  cors: {
    origin: "*", // 开发环境允许所有域名，生产环境改为你的前端域名（如"http://192.168.1.100"）
    methods: ["GET", "POST"]
  }
});

// 匹配池（按等级分类）
const matchPool = {
  新手: [],
  进阶: [],
  资深: []
};

// 房间列表：key=房间ID，value=房间信息
const rooms = {};

// 监听Socket连接
io.on('connection', (socket) => {
  console.log('新客户端连接：', socket.id);

  // 1. 客户端发送匹配请求
  socket.on('start_match', (data) => {
    const { userId, level } = data;
    const targetLevel = ['新手', '进阶', '资深'].includes(level) ? level : '新手';

    // 将用户加入匹配池
    matchPool[targetLevel].push({ socketId: socket.id, userId: userId });
    socket.join(`match_pool_${targetLevel}`);

    // 广播匹配池人数更新
    io.to(`match_pool_${targetLevel}`).emit('match_pool_update', matchPool[targetLevel].length);
    console.log(`用户${socket.id}（${userId}）加入${targetLevel}匹配池，当前人数：${matchPool[targetLevel].length}`);

    // 匹配池满2人则创建房间
    if (matchPool[targetLevel].length >= 2) {
      const player1 = matchPool[targetLevel].shift();
      const player2 = matchPool[targetLevel].shift();
      const roomId = `ROOM_${Date.now().toString().substring(6)}`;

      // 初始化房间信息
      // 房间初始化时修改
rooms[roomId] = {
  players: [player1.socketId, player2.socketId],
  scores: { [player1.socketId]: 0, [player2.socketId]: 0 },
  playerProgress: { [player1.socketId]: 0, [player2.socketId]: 0 }, // 0-10题进度
  isFinished: { [player1.socketId]: false, [player2.socketId]: false }, // 标记是否答完
  currentQuestion: 0,
  status: 'playing', // playing/ended
  timeoutTimer: null,
  syncTimer: setInterval(() => { // 1秒同步状态（保证未答完方进度实时更新）
    const room = rooms[roomId];
    if (!room || room.status !== 'playing') {
      clearInterval(room.syncTimer);
      return;
    }
    io.to(roomId).emit('game_state_sync', {
      scores: room.scores,
      progresses: room.playerProgress,
      isFinished: room.isFinished // 同步谁已答完
    });
  }, 1000)
};

      // 通知双方匹配成功
      io.to(player1.socketId).emit('match_success', {
        roomId: roomId,
        opponentId: player2.userId
      });
      io.to(player2.socketId).emit('match_success', {
        roomId: roomId,
        opponentId: player1.userId
      });

      // 让双方加入房间
      socket.to(player1.socketId).socketsJoin(roomId);
      socket.to(player2.socketId).socketsJoin(roomId);

      // 更新匹配池人数
      io.to(`match_pool_${targetLevel}`).emit('match_pool_update', matchPool[targetLevel].length);
      console.log(`创建房间${roomId}，玩家：${player1.userId} vs ${player2.userId}`);
    }
  });

  // 2. 客户端取消匹配
  socket.on('cancel_match', () => {
    // 从匹配池移除用户
    for (const level in matchPool) {
      const index = matchPool[level].findIndex(item => item.socketId === socket.id);
      if (index !== -1) {
        matchPool[level].splice(index, 1);
        // 广播匹配池人数更新
        io.to(`match_pool_${level}`).emit('match_pool_update', matchPool[level].length);
        console.log(`用户${socket.id}取消匹配，${level}匹配池剩余：${matchPool[level].length}人`);
        break;
      }
    }
  });

  // 3. 客户端提交答案
  socket.on('submit_answer', (data) => {
    const { roomId, questionIndex, isCorrect } = data;
    const room = rooms[roomId];
    if (!room || room.status !== 'playing') return;

    // 更新得分
    room.scores[socket.id] += isCorrect ? 1 : 0;
    room.currentQuestion = questionIndex + 1;

    // 广播给对手
    socket.to(roomId).emit('opponent_answer', {
      questionIndex: questionIndex,
      isCorrect: isCorrect,
      score: room.scores[socket.id]
    });

    console.log(`房间${roomId}，玩家${socket.id}第${questionIndex+1}题${isCorrect ? '答对' : '答错'}，得分：${room.scores[socket.id]}`);

    // 10题答完，结束对战
    if (room.currentQuestion >= 10) {
      const [p1, p2] = room.players;
      const score1 = room.scores[p1];
      const score2 = room.scores[p2];
      const winner = score1 > score2 ? p1 : score2 > score1 ? p2 : 'draw';

      // 通知双方对战结束
      io.to(roomId).emit('battle_end', {
        winner: winner,
        scores: { [p1]: score1, [p2]: score2 }
      });
      room.status = 'ended';

      // 5分钟后清理房间
      setTimeout(() => {
        delete rooms[roomId];
        console.log(`房间${roomId}已解散`);
      }, 300000);
    }
  });

  // 4. 客户端离开房间
  socket.on('leave_room', (data) => {
    const { roomId } = data;
    if (rooms[roomId]) {
      socket.to(roomId).emit('opponent_disconnect');
      delete rooms[roomId];
      console.log(`玩家${socket.id}离开房间${roomId}，房间已解散`);
    }
  });

  // 5. 客户端断开连接
  socket.on('disconnect', () => {
    console.log('客户端断开连接：', socket.id);

    // 从匹配池移除
    for (const level in matchPool) {
      const index = matchPool[level].findIndex(item => item.socketId === socket.id);
      if (index !== -1) {
        matchPool[level].splice(index, 1);
        io.to(`match_pool_${level}`).emit('match_pool_update', matchPool[level].length);
        break;
      }
    }

    // 解散所在房间
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.players.includes(socket.id)) {
        socket.to(roomId).emit('opponent_disconnect');
        delete rooms[roomId];
        console.log(`玩家${socket.id}断开连接，房间${roomId}已解散`);
        break;
      }
    }
  });
});

// 测试接口：访问服务器IP:3000可验证是否运行
app.get('/', (req, res) => {
  res.send('法治星途联机服务器正在运行！');
});

// 启动服务器（端口3000，可修改）
const port = 3000;
server.listen(port, () => {
  console.log(`服务器启动成功，地址：http://localhost:${port}`);
  console.log(`Socket.IO服务：ws://localhost:${port}`);
});
