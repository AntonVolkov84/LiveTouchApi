import express from "express";
import { authenticateToken } from "../middlewares/authenticateToken.js";
import {createPrivateChat, getUserChats} from '../controllers/chatController.js'

const router = express.Router();

router.post("/createprivate", authenticateToken, createPrivateChat);
router.get("/getchats", authenticateToken, getUserChats);

export default router;