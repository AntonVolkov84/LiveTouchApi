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
import {sendExpoPush} from './controllers/chatController.js'
import { pool} from './db/db.js';

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

const upload = multer({ dest: "uploads/" });

app.use("/auth", authRoutes);
app.use("/chats", chatsRoutes);
app.use("/errors", errorsRouter);

app.post("/upload", upload.single("file"), minioController.uploadMinIO)
app.post("/miniodata", minioController.addChatFile)



const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const pendingCalls = new Map();
export const clientsMap = new Map();
wss.on("connection", (ws) => {
 ws.on("message", async(message) => {
    try {
      const data = JSON.parse(message.toString());
      const targetWs = clientsMap.get(data.target);
      switch(data.type) {
      case "init": {
      if (!clientsMap.has(data.userId)) {
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
          `SELECT expo_push_token FROM users WHERE id = $1`,
          [data.target] 
        );
        const expoToken = tokenRows[0]?.expo_push_token;
        const { rows: userRows } = await pool.query(
          `SELECT username, usersurname FROM users WHERE id = $1`,
          [data.sender]
        );
        const callerName = userRows.length
          ? `${userRows[0].usersurname} ${userRows[0].username}`.trim()
          : "Неизвестный";
        if (expoToken) {
          await sendExpoPush(
            expoToken,
            "Входящий звонок",
            `Звонок от ${callerName}`,
            { callerId: data.sender, chatId: data.chatId, callerName },
            "calls-fixed-v1"
          );
        }
        try {
          targetWs?.send(JSON.stringify({
            ...data,
            sender: data.sender || null
          }));
        } catch(e) {
          console.error("Error sending WS message", e);
        }
          
          break;
      }
      case "answer":
        targetWs?.send(JSON.stringify({
          ...data,
          sender: data.sender || null
        }));
        break;
      case "call-ended": {
        pendingCalls.delete(data.target);
        pendingCalls.delete(data.sender);
        const senderWs = clientsMap.get(data.sender);
        targetWs?.send(JSON.stringify({
          ...data,
          sender: data.sender || null
        }));
        senderWs?.send(JSON.stringify({
          ...data,
          sender: data.sender || null
        }));
        break;
      }
      case "ice-candidate":
        if (!targetWs) {
          const pending = pendingCalls.get(data.target);
          if (pending) {
            pending.ice.push(data);
          }
        }
        targetWs?.send(JSON.stringify({
          ...data,
          sender: data.sender || null
        }));
        break;
      
      default:
        console.warn("Unknown WS type:", data.type);
    }
    } catch (err) {
      console.error("WS message error:", err);
    }
  });
  ws.on("close", (code, reason) => {
    for (const [userId, sockets] of clientsMap.entries()) {
      if (sockets.has(ws)) {
        sockets.delete(ws);
        if (sockets.size === 0) {
          clientsMap.delete(userId);
        }
        console.log(`Device disconnected for user ${userId}. Remaining: ${sockets.size || 0}`);
        break;
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