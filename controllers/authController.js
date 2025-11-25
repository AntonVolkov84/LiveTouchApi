import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db/db.js"; 
import crypto from "crypto";
import { Resend } from "resend";
import { verifyCaptcha } from '../utils/verifyRecaptcha.js'
import { minioClient } from '../minio.js'

const resend = new Resend(process.env.RESEND_API);

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

const generateTokens = (user) => {
  const accessToken = jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: "15m" }
  );
  const refreshToken = jwt.sign(
    { id: user.id, email: user.email },
    JWT_REFRESH_SECRET,
    { expiresIn: "7d" }
  );
  return { accessToken, refreshToken };
};

export const register =  async (req, res) => {
  try {
    const { username, usersurname, password, captchaToken, public_key } = req.body;
    const email = req.body.email?.trim().toLowerCase();
    
    if (!captchaToken) {
      return res.status(400).json({ message: "Captcha token missing" });
    }
    if (!username || !usersurname|| !password || !email || !public_key) {
      return res.status(422).json({ message: "Not enough data" });
    }
    const forbiddenPattern = /[<>]/;
    if (forbiddenPattern.test(username) || forbiddenPattern.test(usersurname)) {
      return res.status(422).json({ message: "Имя и фамилия содержат недопустимые символы" });
    }
    const captchaResult = await verifyCaptcha(captchaToken, process.env.LIVETOUCH_PROJECT_NUMBER);

    if (!captchaResult.success) {
      return res.status(403).json({ message: 'Captcha verification failed' });
    }

    const existing = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: "User already exists" });
    }
    const hashed = await bcrypt.hash(password, 10);
    const emailToken = crypto.randomUUID();
    const insertQuery = `
      INSERT INTO users (username, password_hash, email, email_confirm_token, is_verified, usersurname, public_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id, username, email, email_confirm_token, usersurname, public_key;
    `;
    const values = [username, hashed, email, emailToken, false, usersurname, public_key];
    const result = await pool.query(insertQuery, values);
    const user = result.rows[0];
    try {
      await sendConfirmationEmail(email, emailToken);
    } catch (mailErr) {
      console.error("Ошибка при отправке письма:", mailErr);
    }
    res.status(201).json({ message: "Письмо для подтверждения отправлено на email" });
  } catch (err) {
    console.error("mobile register error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const login = async (req, res) => {
  try {
    const { password, public_key } = req.body;
    const email = req.body.email?.trim().toLowerCase();
    if (!email || !password || !public_key) {
      return res.status(422).json({ message: "Not enough data" });
    }
    const emailRegex = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
    if (!emailRegex.test(email)) {
      return res.status(422).json({ message: "Некорректный email" });
    }
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    const user = result.rows[0];
    if (!user.is_verified) {
      return res.status(403).json({ message: "Email not confirmed" });
    }
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    await pool.query(
      "UPDATE users SET public_key = $1 WHERE id = $2",
      [public_key, user.id]
    );
    const { accessToken, refreshToken } = generateTokens(user);
    const { password_hash, ...userSafe } = user;
    res.status(200).json({ accessToken, refreshToken, user: userSafe });
    } catch (err) {
    console.error("mobile login error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const me = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE id = $1",
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: "User not found" });
    res.json({
      id: result.rows[0].id,
      username: result.rows[0].username,
      usersurname: result.rows[0].usersurname,
      email: result.rows[0].email,
      avatar_url: result.rows[0].avatar_url,
      phone: result.rows[0].phone,
      bio: result.rows[0].bio,
      is_verified: result.rows[0].is_verified,
      created_at: result.rows[0].created_at,
      public_key: result.rows[0].public_key,
    });
  } catch (error) {
    console.error("Error fetching mobile user info:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const refreshAccessToken = async (req, res) => {
  const { token: refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ message: "No refresh token" });
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const userResult = await pool.query("SELECT id FROM users WHERE id=$1", [decoded.id]);
    if (!userResult.rows.length) return res.status(404).json({ message: "User not found" });
    const accessToken = jwt.sign({ id: decoded.id, email: decoded.email }, process.env.JWT_SECRET, { expiresIn: "15m" });
    res.json({ accessToken });
  } catch (err) {
    console.error("Refresh token error:", err);
    res.status(403).json({ message: "Invalid refresh token" });
  }
};
export async function sendConfirmationEmail(to, token) {
  const confirmLink = `https://api.livetouch.chat/auth/confirm-email?token=${token}`;
  try {
    await resend.emails.send({
      from: "LiveTouch <no-reply@livetouch.chat>",
      to,
      subject: "Подтверждение регистрации в LiveTouch",
      html: `<p>Здравствуйте!</p>
             <p>Для подтверждения регистрации перейдите по ссылке:</p>
             <a href="${confirmLink}">${confirmLink}</a>`,
    });
  } catch (error) {
    console.error("❌ Ошибка отправки email через Resend:", error);
    throw error;
  }
}
export const requestPasswordReset = async (req, res) => {
  try {
    const { newPassword } = req.body;
    const email = req.body.email?.trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "Email is required" });
    if (!newPassword) return res.status(400).json({ message: "newPassword is required" });
    const userRes = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (userRes.rowCount === 0) {
      return res.status(200).json({ message: "If email exists, reset link was sent" });
    }
    const user = userRes.rows[0];
    const token = crypto.randomUUID();
    const expires = new Date(Date.now() + 1000 * 60 * 60); 
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query(
      "UPDATE users SET forgot_password_token = $1, forgot_password_expires = $2, forgot_password_hashed = $3 WHERE id = $4",
      [token, expires, hashedPassword, user.id]
    );
    const resetLink = `https://api.livetouch.chat/auth/reset-password?token=${token}`;
     const data = await resend.emails.send({
      from: "LiveTouch <no-reply@livetouch.chat>",
      to: email,
      subject: "Восстановление пароля LiveTouch",
      html: `
        <p>Здравствуйте, ${user.username}!</p>
        <p>Для восстановления пароля перейдите по ссылке:</p>
        <a href="${resetLink}">${resetLink}</a>
        <p>Ссылка действительна 1 час.</p>
      `,
    });
    res.status(200).json({ message: "Password reset email sent" });
  } catch (err) {
    console.error("Error in requestPasswordReset:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { token } = req.query; 
    if (!token )
      return res.status(400).json({ message: "Token is required" });

    const result = await pool.query(
      "SELECT * FROM users WHERE forgot_password_token = $1 AND forgot_password_expires > NOW()",
      [token]
    );

    if (result.rowCount === 0)
      return res.status(400).json({ message: "Invalid or expired token" });

    const user = result.rows[0];
    const hashedPassword = user.forgot_password_hashed;
    await pool.query(
      `UPDATE users 
      SET password_hash = $1, forgot_password_token = NULL, forgot_password_expires = NULL, forgot_password_hashed = NULL
      WHERE id = $2`,
      [hashedPassword, user.id]
    );
    res.send(`
      <html>
        <head><title>Email confirmed</title></head>
        <body style="font-family:sans-serif; padding:20px;">
          <h1>Your password change successfuly</h1>
          <p>You may close this window.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Error in resetPassword:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const confirmEmail = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ message: "No token provided" });
    const result = await pool.query(
      "SELECT * FROM users WHERE email_confirm_token = $1",
      [token]
    );
    if (result.rowCount === 0)
      return res.status(400).json({ message: "Invalid token" });
    await pool.query(
      "UPDATE users SET is_verified = true, email_confirm_token = NULL WHERE id = $1",
      [result.rows[0].id]
    );
    res.send(`
      <html>
        <head><title>Email confirmed</title></head>
        <body style="font-family:sans-serif; padding:20px;">
          <h1>Email successfully confirmed</h1>
          <p>You may close this window.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("confirmEmail error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
export const updateAvatar = async (req, res) => {
  try {
    const userId = req.user.id;
    const { avatar_url } = req.body;
    if (!avatar_url) {
      return res.status(400).json({ message: "avatar_url is required" });
    }
    const oldData = await pool.query(
      "SELECT avatar_url FROM users WHERE id = $1",
      [userId]
    );
    const oldUrl = oldData.rows[0]?.avatar_url;
    if (oldUrl) {
      try {
        const parts = oldUrl.replace("https://api.livetouch.chat/", "").split("/");
        const bucket = parts[0];
        const object = parts.slice(1).join("/");
        console.log(parts)
        console.log(bucket)
        console.log(object)
        await minioClient.removeObject(bucket, object);
        console.log("Old avatar removed:", oldUrl);
      } catch (err) {
        console.warn("Cannot delete old avatar (maybe not exist):", err.message);
      }
    }
    await pool.query(
      "UPDATE users SET avatar_url = $1 WHERE id = $2",
      [avatar_url, userId]
    );
    res.json({ message: "Avatar updated", avatar_url });
  } catch (err) {
    console.error("updateAvatar error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    let { username, surname, bio, phone } = req.body;
    const sanitize = (str) =>
      String(str || "")
        .replace(/<script.*?>.*?<\/script>/gi, "")
        .replace(/<\/?[^>]+(>|$)/g, "") 
        .trim();

    username = sanitize(username);
    surname = sanitize(surname);
    bio = sanitize(bio);
    phone = sanitize(phone);

    if (username.length > 32) {
      return res.status(400).json({ message: "Username too long" });
    }
    if (surname.length > 32) {
      return res.status(400).json({ message: "Surname too long" });
    }
    if (bio.length > 500) {
      return res.status(400).json({ message: "Bio too long" });
    }

    await pool.query(
      `UPDATE users 
       SET username = $1, usersurname = $2, bio = $3, phone = $4
       WHERE id = $5`,
      [username, surname, bio, phone, userId]
    );

    res.status(200).json({
      message: "Profile updated",
      username,
      surname,
      bio,
      phone,
    });
  } catch (err) {
    console.error("updateProfile error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
