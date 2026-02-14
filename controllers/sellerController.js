import { pool } from "../db/db.js"; 
import { Resend } from "resend";
import { minioClient } from '../minio.js'
import {deleteFileMinIO, uploadToMinioHelper} from './minioController.js'
import ngeo from "ngeohash"

export const initSellerProfile = async (req, res) => {
    const { phone } = req.body;
    const userId = req.user.id; 
    if (!phone) {
        return res.status(400).json({ error: "Номер телефона обязателен" });
    }
    try {
        const result = await pool.query(
            `INSERT INTO seller_profiles (user_id, phone, shop_name)
             VALUES ($1, $2, 'In progress...')
             ON CONFLICT (user_id) 
             DO UPDATE SET phone = EXCLUDED.phone
             RETURNING *`,
            [userId, phone]
        );
        res.status(200).json({
            success: true,
            message: "Профиль инициализирован",
            data: result.rows[0]
        });
    } catch (error) {
        console.error("Ошибка в initSellerProfile:", error);
        res.status(500).json({ error: "Ошибка сервера при создании профиля" });
    }
};
export const checkTelegramAuth = async (req, res) => {
    const userId = req.user.id;
    try {
        const result = await pool.query(
            "SELECT telegram_chat_id FROM seller_profiles WHERE user_id = $1",
            [userId]
        );
        if (result.rows[0]?.telegram_chat_id) {
            res.json({ linked: true });
        } else {
            res.json({ linked: false });
        }
    } catch (error) {
        res.status(500).json({ error: "Ошибка проверки Telegram" });
    }
};
export const completeSellerRegistration = async (req, res) => {
    const { 
        shop_name, 
        opening_time, 
        closing_time, 
        payment_details, 
        location_lat, 
        location_lng, 
        geohash 
    } = req.body;
    const userId = req.user.id;
    try {
        const profileResult = await pool.query(
            `UPDATE seller_profiles 
             SET shop_name = $1, 
                 opening_time = $2, 
                 closing_time = $3, 
                 payment_details = $4, 
                 location_lat = $5, 
                 location_lng = $6, 
                 geohash = $7,
                 updated_at = NOW()
             WHERE user_id = $8 
             RETURNING *`,
            [shop_name, opening_time, closing_time, payment_details, location_lat, location_lng, geohash, userId]
        );
        if (profileResult.rowCount === 0) {
            return res.status(404).json({ error: "Профиль не найден. Начните регистрацию сначала." });
        }
        await pool.query(
            "UPDATE users SET role = 'seller' WHERE id = $1",
            [userId]
        );
        res.status(200).json({
            success: true,
            message: "Поздравляем! Вы стали продавцом.",
            data: profileResult.rows[0]
        });
    } catch (error) {
        console.error("Ошибка в completeSellerRegistration:", error);
        res.status(500).json({ error: "Не удалось завершить регистрацию" });
    }
};
export const getSellerProfile = async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM seller_profiles WHERE user_id = $1",
            [req.user.id]
        );
        res.json({ success: true, profile: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: "Ошибка сервера" });
    }
};

export const updateProduct = async (req, res) => {
  const { id } = req.params;
  const { name, description, price, quantities } = req.body;
  const seller_id = req.user.id;
  const file = req.file; 
  try {
    const productData = await pool.query(
      "SELECT image_name FROM products WHERE id = $1 AND seller_id = $2",
      [id, seller_id]
    );

    if (productData.rows.length === 0) return res.status(404).send("Товар не найден");
    const oldImageName = productData.rows[0].image_name;
    let updatedImageUrl = null;
    let updatedImageName = null;
    if (file) {
      updatedImageName = `prod_${Date.now()}_${file.originalname}`;
      updatedImageUrl = await uploadToMinioHelper(file, 'photos', updatedImageName);
      if (oldImageName) {
        await deleteFileMinIO('photos', oldImageName);
      }
    }
    const updateQuery = `
      UPDATE products 
      SET name = $1, description = $2, price = $3, quantities = $4, 
          image_url = COALESCE($5, image_url), 
          image_name = COALESCE($6, image_name),
          updated_at = NOW()
      WHERE id = $7 AND seller_id = $8
      RETURNING *`;
    const result = await pool.query(updateQuery, [
      name, 
      description, 
      price, 
      quantities, 
      updatedImageUrl, 
      updatedImageName, 
      id, 
      seller_id
    ]);
    res.json({ success: true, product: result.rows[0] });
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).send("Ошибка при обновлении");
  }
};

export const getSellerProducts = async (req, res) => {
    const seller_id = req.user.id;
    try {
        const result = await pool.query(
            "SELECT * FROM products WHERE seller_id = $1 ORDER BY created_at DESC",
            [seller_id]
        );
        res.json({ success: true, products: result.rows });
    } catch (error) {
        console.error("Ошибка в getSellerProducts:", error);
        res.status(500).json({ error: "Ошибка сервера при получении товаров" });
    }
};

export const addProduct = async (req, res) => {
    const { name, description, price, quantities } = req.body;
    const seller_id = req.user.id;
    const file = req.file;
    let imageUrl = null;
    let imageName = null;
    try {
        if (file) {
            imageName = `prod_${Date.now()}_${file.originalname}`;
            await minioClient.fPutObject('photos', imageName, file.path, {
                'Content-Type': file.mimetype
            });
            imageUrl = `https://api.livetouch.chat/photos/${imageName}`;
        }
        const result = await pool.query(
            `INSERT INTO products (seller_id, name, description, price, quantities, image_url, image_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [seller_id, name, description, price, quantities || 0, imageUrl, imageName]
        );
        res.status(201).json({ success: true, product: result.rows[0] });
    } catch (error) {
        console.error("Ошибка в addProduct:", error);
        res.status(500).json({ error: "Не удалось добавить товар" });
    }
};

export const deleteProduct = async (req, res) => {
    const { id } = req.params;
    const seller_id = req.user.id;
    try {
        const product = await pool.query(
            "SELECT image_name FROM products WHERE id = $1 AND seller_id = $2",
            [id, seller_id]
        );
        if (product.rowCount === 0) {
            return res.status(404).json({ error: "Товар не найден" });
        }
        const imageName = product.rows[0].image_name;
        await pool.query("DELETE FROM products WHERE id = $1 AND seller_id = $2", [id, seller_id]);
        if (imageName) {
            await deleteFileMinIO('photos', imageName);
        }
        res.json({ success: true, message: "Товар успешно удален" });
    } catch (error) {
        console.error("Ошибка в deleteProduct:", error);
        res.status(500).json({ error: "Ошибка при удалении товара" });
    }
};
export const getNearbyShops = async (req, res) => {
    const { lat, lng } = req.query;
    if (!lat || !lng) {
        return res.status(400).json({ error: "Координаты (lat, lng) обязательны" });
    }
    try {
        const centralHash = ngeo.encode(parseFloat(lat), parseFloat(lng), 6);
        const neighbors = ngeo.neighbors(centralHash); 
        const searchArea = [centralHash, ...neighbors];
        const query = `
            SELECT 
            sp.id as shop_id,
            sp.user_id as shop_owner_id,
            sp.shop_name,
            sp.phone,
            sp.opening_time,
            sp.closing_time,
            sp.payment_details,
            p.id as product_id,
            p.name as product_name,
            p.description as product_description,
            p.price as product_price,
            p.quantities as product_quantities,
            p.image_url as product_image,
            p.is_active as product_is_active
        FROM seller_profiles sp
        LEFT JOIN products p ON sp.user_id = p.seller_id
        WHERE LEFT(sp.geohash, 6) IN ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
        AND (p.is_active = TRUE OR p.id IS NULL)
        `;
        const { rows } = await pool.query(query, searchArea);
        const shopsMap = {};
        rows.forEach(row => {
            if (!shopsMap[row.shop_id]) {
                shopsMap[row.shop_id] = {
                    shop_id: row.shop_id,
                    shop_owner_id: row.shop_owner_id,
                    shop_name: row.shop_name,
                    phone: row.phone,
                    opening_time: row.opening_time,
                    closing_time: row.closing_time,
                    payment_details: row.payment_details,
                    products: []
                };
            }
            if (row.product_id) {
                shopsMap[row.shop_id].products.push({
                    id: row.product_id,
                    name: row.product_name,
                    description: row.product_description,
                    price: parseFloat(row.product_price),
                    quantities: parseFloat(row.product_quantities),
                    image_url: row.product_image,
                    is_active: row.product_is_active
                });
            }
        });
        const result = Object.values(shopsMap);
        if (result.length === 0) {
            return res.status(200).json({
                status: "success",
                count: 0,
                data: [],
                message: "Поблизости ничего не найдено" 
            });
        }
        res.json({
            status: "success",
            count: Object.keys(shopsMap).length,
            data: Object.values(shopsMap)
        });
    } catch (error) {
        console.error("Ошибка в getNearbyShops:", error);
        res.status(500).json({ error: "Ошибка при поиске" });
    }
};