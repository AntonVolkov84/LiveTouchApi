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
 ws.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.userId) {
        clientsMap.set(data.userId, ws);
        console.log("Registered userId:", data.userId);
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