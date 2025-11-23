import express from "express";
import { authenticateToken } from "../middlewares/authenticateToken.js";
import {createPrivateChat, getUserChats, createGroupChat, leaveChat} from '../controllers/chatController.js'

const router = express.Router();

router.post("/createprivate", authenticateToken, createPrivateChat);
router.get("/getchats", authenticateToken, getUserChats);
router.post("/creategroup", authenticateToken, createGroupChat);
router.delete("/leave/:chatId", authenticateToken, leaveChat);

export default router;