import express from "express";
import {
  register,
  login,
  me,
  refreshAccessToken,
  requestPasswordReset,
  resetPassword,
  confirmEmail,
  updateAvatar,
  updateProfile,
  addExpoPushToken
  } from "../controllers/authController.js";
import { authenticateToken } from "../middlewares/authenticateToken.js";

const router = express.Router();

router.post("/register", register);

router.post("/login", login);
router.put("/expotoken", authenticateToken, addExpoPushToken);

router.get("/me", authenticateToken, me);

router.post("/refresh", refreshAccessToken);

router.get("/confirm-email", confirmEmail);

router.post("/forgot-password", requestPasswordReset);

router.get("/reset-password", resetPassword);

router.put("/update-avatar", authenticateToken,updateAvatar);

router.put("/update-profile", authenticateToken, updateProfile);


export default router;
