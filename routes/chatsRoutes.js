import express from "express";
import { authenticateToken } from "../middlewares/authenticateToken.js";
import {createPrivateChat, addParticipant, getUserChats, deleteMessage, updateMessage, createGroupChat, getUnread, clearChatUnread, clearAllUnread, getChatParticipants, leaveChat, sendMessage, getMessages} from '../controllers/chatController.js'

const router = express.Router();

router.post("/createprivate", authenticateToken, createPrivateChat);
router.delete("/unread", authenticateToken, clearAllUnread);
router.get("/getchats", authenticateToken, getUserChats);
router.post("/creategroup", authenticateToken, createGroupChat);
router.post("/send", authenticateToken, sendMessage);
router.post("/addparticipant", authenticateToken, addParticipant);
router.get("/unread", authenticateToken, getUnread);
router.get("/:chat_id/participants", authenticateToken, getChatParticipants);
router.delete("/leave/:chatId", authenticateToken, leaveChat);
router.get("/:chat_id", authenticateToken, getMessages);
router.delete("/unread/:chatId", authenticateToken, clearChatUnread);
router.delete("/message/:messageId", authenticateToken, deleteMessage);
router.put("/message/:messageId", authenticateToken, updateMessage);

export default router;