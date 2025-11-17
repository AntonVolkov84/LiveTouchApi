import dotenv from 'dotenv';
dotenv.config();
import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from 'ws';
import * as minioController from './controllers/minioController.js';
import multer from "multer";
import authRoutes from "./routes/authRoutes.js";

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

app.use("/auth", authRoutes);

app.post("/upload", upload.single("file"), minioController.uploadMinIO)



const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  console.log("WS client connected");
  ws.on("message", (message) => {
    try {
      console.log("Received:", message.toString());
      ws.send("Echo: " + message.toString());
    } catch (err) {
      console.error("Error handling message:", err);
      ws.send("Error: " + err.message);  
    }
  });
  ws.on("close", () => console.log("WS client disconnected"));
  ws.on("error", (err) => {
    console.error("WS Error:", err);
    ws.send("Error: WebSocket error");  
  });
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log("HTTP Server running on port 3002");
});
