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
app.use(cors());
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
export const clientsMap = new Map();
wss.on("connection", (ws) => {
 ws.on("message", async(message) => {
    try {
      const data = JSON.parse(message.toString());
      const targetWs = clientsMap.get(data.target);
      switch(data.type) {
      case "offer":
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
            { callerId: data.sender, chatId: data.chatId, callerName }
          );
        }
          targetWs?.send(JSON.stringify({
            ...data,
            sender: data.sender || null
          }));
          break;
      case "answer":
        targetWs?.send(JSON.stringify({
          ...data,
          sender: data.sender || null
        }));
        break;
      case "ice-candidate":
        targetWs?.send(JSON.stringify({
          ...data,
          sender: data.sender || null
        }));
        break;
      case "init":
        clientsMap.set(data.userId, ws);
        console.log("Registered userId:", data.userId);
        break;
      default:
        console.warn("Unknown WS type:", data.type);
    }
    } catch (err) {
      console.error("WS message error:", err);
    }
  });
  ws.on("close", (code, reason) => {
    console.log("WS CLOSED", { code, reason: reason?.toString() });
    for (const [userId, client] of clientsMap.entries()) {
      if (client === ws) {
        clientsMap.delete(userId);
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