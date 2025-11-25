import express from "express";
import { authenticateToken } from "../middlewares/authenticateToken.js";
import {createPrivateChat, getUserChats, createGroupChat, getChatParticipants, leaveChat, sendMessage, getMessages} from '../controllers/chatController.js'

const router = express.Router();

router.post("/createprivate", authenticateToken, createPrivateChat);
router.get("/getchats", authenticateToken, getUserChats);
router.post("/creategroup", authenticateToken, createGroupChat);
router.delete("/leave/:chatId", authenticateToken, leaveChat);
router.post("/send", authenticateToken, sendMessage);
router.get("/:chat_id", authenticateToken, getMessages);
router.get("/:chat_id/participants", authenticateToken, getChatParticipants);

export default router;