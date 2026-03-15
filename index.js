import dotenv from 'dotenv';
dotenv.config();
import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from 'ws';
import * as minioController from './controllers/minioController.js';
import multer from "multer";
import authRoutes from "./routes/authRoutes.js";
import chatsRoutes from "./routes/chatsRoutes.js"
import errorsRouter from "./routes/errorsRouter.js"
import sellerRouter from "./routes/sellerRouter.js"
import {sendExpoPush} from './controllers/chatController.js'
import { pool} from './db/db.js';
// import { initTelegramBot } from './services/telegramBot.js';
import { sendMessageNotification} from './pushService.js'

const app = express();

const allowedOrigins = [
  'https://livetouch.chat',
  'https://www.livetouch.chat',
  'http://localhost:5173' 
];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true 
}));

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));
// initTelegramBot();
const upload = multer({ dest: "uploads/" });

app.use("/auth", authRoutes);
app.use("/chats", chatsRoutes);
app.use("/errors", errorsRouter);
app.use("/seller", sellerRouter);

app.post("/upload", upload.single("file"), minioController.uploadMinIO)
app.post("/miniodata", minioController.addChatFile)


const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const pendingCalls = new Map();
const chatRooms = new Map();
export const clientsMap = new Map();
wss.on("connection", (ws) => {
 ws.on("message", async(message) => {
    try {
      const data = JSON.parse(message.toString());
      const targetWs = clientsMap.get(data.target);
      switch(data.type) {
      case "init": {
      if (!clientsMap.has(data.userId)) {
        ws.userId = data.userId;
        clientsMap.set(data.userId, new Set());
      }
        clientsMap.get(data.userId).add(ws);
        console.log(`User ${data.userId} connected. Total devices: ${clientsMap.get(data.userId).size}`);
      break;
    }
      case "pending-ready": {
      const pending = pendingCalls.get(data.sender);
      if (pending) {
        if (pending.offer) {
          ws.send(JSON.stringify(pending.offer));
        }
        for (const ice of pending.ice) {
          ws.send(JSON.stringify(ice));
        }
        pendingCalls.delete(data.sender);
      }
      break;
    }
      case "offer": {
        const timestamp = Date.now();
        if (!targetWs) {
            pendingCalls.set(data.target, {
              offer: { ...data, timestamp },
              ice: []
            });
          }
          const { rows: tokenRows } = await pool.query(
          `SELECT expo_push_token, fcm_token FROM users WHERE id = $1`,
          [data.target] 
        );
        const expoToken = tokenRows[0]?.expo_push_token;
        const fcmToken = tokenRows[0]?.fcm_token;
        const { rows: userRows } = await pool.query(
          `SELECT username, usersurname FROM users WHERE id = $1`,
          [data.sender]
        );
        const callerName = userRows.length
          ? `${userRows[0].usersurname} ${userRows[0].username}`.trim()
          : "Неизвестный";
          if (fcmToken) {
            const title = "Входящий звонок";
            const body = `Звонок от ${callerName}`;
            const pushData = { 
              callerId: String(data.sender), 
              chatId: String(data.chatId), 
              callerName: String(callerName), 
              type: "INCOMING_CALL"
              };
          await sendMessageNotification(fcmToken, title, body, pushData, 
            "calls-fixed-v1", null, String(data.chatId))
         } else if (expoToken) {
          await sendExpoPush(
            expoToken,
            "Входящий звонок",
            `Звонок от ${callerName}`,
            { callerId: data.sender, chatId: data.chatId, callerName },
            "calls-fixed-v1",
            "call"
          );
        }
        const { rows } = await pool.query(
        `INSERT INTO call_logs (chat_id, caller_id, receiver_id, status) 
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [data.chatId, data.sender, data.target, 'initiated']
         );
        try {
          if (targetWs && targetWs instanceof Set) {
            targetWs.forEach((socket) => {
              if (socket.readyState === 1) { 
                try {
                  socket.send(JSON.stringify({
                    ...data,
                    callerName: callerName,
                    sender: data.sender || null
                  }));
                } catch (e) {
                  console.error("Error sending to one of the devices:", e);
                }
              }
            });
          }
        } catch(e) {
          console.error("Error sending WS message", e);
        }
          
          break;
      }
      case "answer": {
        const payload = JSON.stringify({
          ...data,
          sender: data.sender || null
        });
        await pool.query(
        `UPDATE call_logs SET status = 'active', started_at = CURRENT_TIMESTAMP 
         WHERE chat_id = $1 AND caller_id = $2 AND status = 'initiated'`,
        [data.chatId, data.target] 
        );
        if (targetWs && targetWs instanceof Set) {
          targetWs.forEach((socket) => {
            if (socket.readyState === 1) socket.send(payload);
          });
        }
        const senderWs = clientsMap.get(data.sender);
        if (senderWs instanceof Set) {
          senderWs.forEach((socket) => {
            if (socket.readyState === 1 && socket !== ws) { 
              socket.send(payload);
            }
          });
        }
        break;
      }
      case "call-ended": {
        const result = await pool.query(
          `UPDATE call_logs 
          SET ended_at = CURRENT_TIMESTAMP, 
              duration = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at))::int,
              status = CASE WHEN status = 'initiated' THEN 'missed' ELSE 'completed' END
          WHERE chat_id = $1 AND (caller_id = $2 OR receiver_id = $2) AND ended_at IS NULL
          RETURNING *`, 
          [data.chatId, data.sender]
        );
        const callRecord = result.rows[0];
        if (callRecord && callRecord.status === 'missed') {
        const victimId = callRecord.receiver_id;
        if (callRecord && callRecord.status === 'missed') {
          const { rows: userRows } = await pool.query(
          `SELECT username, usersurname FROM users WHERE id = $1`,
          [data.sender]
        );
        const callerName = userRows.length
          ? `${userRows[0].usersurname} ${userRows[0].username}`.trim()
          : "Неизвестный";
        const { rows: victimRows } = await pool.query(
          `SELECT fcm_token FROM users WHERE id = $1`,
          [victimId]
        );
        if (victimRows[0]?.fcm_token) {
        await sendMessageNotification(
            victimRows[0].fcm_token,
            "Пропущенный вызов",
            `Был звонок от ${callerName}`,
            { type: "MISSED_CALL", chatId: String(data.chatId) },
            "default",          
            null,               
            String(data.chatId) 
          );
        }
      }
    }
        pendingCalls.delete(data.target);
        pendingCalls.delete(data.sender);
        const senderWs = clientsMap.get(data.sender); 
        const payload = JSON.stringify({
          ...data,
          sender: data.sender || null
        });
        if (targetWs instanceof Set) {
          targetWs.forEach(socket => {
            if (socket.readyState === 1) socket.send(payload);
          });
        }
          if (senderWs instanceof Set) {
            senderWs.forEach(socket => {
              if (socket.readyState === 1) socket.send(payload);
            });
          }
          break;
        }
      case "join-chat": {
          try {
              const chatId = String(data.chatId || data.chat_id); 
              const userId = String(data.userId || data.user_id);
              console.log(`[JOIN] Chat: ${chatId}, User: ${userId}`);
              ws.currentChatId = chatId; 
              if (!chatRooms.has(chatId)) {
                  chatRooms.set(chatId, new Set());
              }
              const room = chatRooms.get(chatId);
              room.add(userId);
              room.forEach(memberId => {
                  if (String(memberId) === userId) return; 
                  const targetSockets = clientsMap.get(Number(memberId));
                  if (targetSockets instanceof Set) {
                      targetSockets.forEach(s => {
                          if (s.readyState === 1) {
                              s.send(JSON.stringify({
                                  type: "user_status_update",
                                  user_id: userId,
                                  status: "online",
                                  chat_id: chatId
                              }));
                          }
                      });
                  }
              });
              const snapshot = {
                  type: "room_snapshot",
                  chat_id: chatId,
                  online_users: Array.from(room).map(Number)
              };
              ws.send(JSON.stringify(snapshot));
              console.log(`[SENT] Snapshot to User ${userId}:`, snapshot.online_users);
          } catch (err) {
              console.error("!!! Ошибка в join-chat !!!", err);
          }
          break;
      }
       case "typing": {
        console.log(data, chatRooms)
          const chatId = String(data.chatId || data.chat_id); 
          const userId = String(data.userId || data.user_id);
          const isTyping = data.isTyping;
          const members = chatRooms.get(chatId);
          if (!members) {
              console.log(`[TYPING] Комната ${chatId} не найдена или пуста`);
              break;
          }
          members.forEach(memberId => {
              if (String(memberId) === String(userId)) return; 
              const targetSockets = clientsMap.get(Number(memberId)) || clientsMap.get(String(memberId));
              if (targetSockets) {
                  targetSockets.forEach(s => {
                      if (s.readyState === 1) {
                          s.send(JSON.stringify({
                              type: "user_typing_update",
                              user_id: userId,
                              chat_id: chatId,
                              isTyping: isTyping
                          }));
                      }
                  });
              } else {
                  console.log(`[TYPING] Сокеты для юзера ${memberId} не найдены в clientsMap`);
              }
          });
          break;
      }
      case "ice-candidate":
        if (!targetWs) {
        const pending = pendingCalls.get(data.target);
        if (pending) {
          pending.ice.push(data);
        }
      } else if (targetWs instanceof Set) {
        const payload = JSON.stringify({
          ...data,
          sender: data.sender || null
        });
          targetWs.forEach((socket) => {
            if (socket.readyState === 1) {
              try {
                socket.send(payload);
              } catch (e) {
                console.error("Error sending ICE candidate:", e);
              }
            }
          });
        }
        break;
        default:
        console.warn("Unknown WS type:", data.type);
    }
    } catch (err) {
      console.error("WS message error:", err);
    }
  });
  ws.on("close", () => {
    const userId = ws.userId;
    const chatId = ws.currentChatId;
    if (userId) {
        const uid = String(userId);
        const userSockets = clientsMap.get(Number(uid)) || clientsMap.get(uid);
        if (userSockets) {
            userSockets.delete(ws);
            if (userSockets.size === 0) {
                clientsMap.delete(Number(uid));
                clientsMap.delete(uid);
                chatRooms.forEach((members, rId) => {
                    const membersArray = Array.from(members).map(String);
                    if (membersArray.includes(uid)) {
                        members.delete(uid);
                        members.delete(Number(uid));
                        members.forEach(mId => {
                            const targetSockets = clientsMap.get(Number(mId)) || clientsMap.get(String(mId));
                            targetSockets?.forEach(s => {
                                if (s.readyState === 1) {
                                    try {
                                        s.send(JSON.stringify({
                                            type: "user_status_update",
                                            user_id: uid, 
                                            status: "offline",
                                            chat_id: rId
                                        }));
                                    } catch (e) {
                                        console.error("Ошибка при отправке оффлайна:", e);
                                    }
                                }
                            });
                        });
                    }
                });
            }
        }
    }
});
  ws.on("error", (err) => {
  console.error("WS SERVER ERROR", err);
  });
});
const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log("HTTP Server running on port 3002");
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("UNHANDLED REJECTION:", reason);
});

export { wss };