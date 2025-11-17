import express from "express";
import {
  register,
  login,
  me,
  refreshAccessToken,
  requestPasswordReset,
  resetPassword,
  confirmEmail,
} from "../controllers/authController.js";
import { authenticateToken } from "../middlewares/authenticateToken.js";

const router = express.Router();

router.post("/register", register);

router.post("/login", login);

router.get("/me", authenticateToken, me);

router.post("/refresh", refreshAccessToken);

router.get("/confirm-email", confirmEmail);

router.post("/forgot-password", requestPasswordReset);

router.get("/reset-password", resetPassword);

export default router;
