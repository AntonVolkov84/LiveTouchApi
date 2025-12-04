import express from "express";
import {postLog} from "../controllers/errorController.js"

const router = express.Router();

router.post("/log", postLog);

export default router;