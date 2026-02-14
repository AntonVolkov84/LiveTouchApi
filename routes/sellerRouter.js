import {
 initSellerProfile,
 checkTelegramAuth,
 completeSellerRegistration,
 getSellerProfile,
 getSellerProducts,
 addProduct,
 updateProduct,
 deleteProduct,
 getNearbyShops
} from "../controllers/sellerController.js";
import multer from "multer";
const upload = multer({ dest: "uploads/" });
import express from "express";
import { authenticateToken } from "../middlewares/authenticateToken.js";
const router = express.Router();
router.post('/init-seller', authenticateToken, initSellerProfile);
router.get('/check-tg', authenticateToken, checkTelegramAuth);
router.put('/complete-registration', authenticateToken, completeSellerRegistration);
router.get('/profile', authenticateToken, getSellerProfile);

router.get("/products", authenticateToken, getSellerProducts);
router.post("/products", authenticateToken, upload.single("image"), addProduct);
router.put("/products/:id", authenticateToken, upload.single("image"), updateProduct);
router.delete("/products/:id", authenticateToken, deleteProduct);
router.get('/shops/nearby', getNearbyShops);

export default router;
