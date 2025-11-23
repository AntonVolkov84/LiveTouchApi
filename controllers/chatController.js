import { pool } from "../db/db.js"; 
import { minioClient } from '../minio.js'
import { wss } from "../index.js";
import { clientsMap } from '../index.js'; 

export const createPrivateChat = async (req, res) => {
  try {
    const userId = req.user.id;  
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email обязателен" });
    }
    const otherUser = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (otherUser.rows.length === 0) {
      return res.status(404).json({ message: "Пользователь не найден" });
    }
    const otherUserId = otherUser.rows[0].id;
    const existingChat = await pool.query(
      `SELECT c.id FROM chats c
       JOIN chat_participants cp1 ON c.id = cp1.chat_id AND cp1.user_id = $1
       JOIN chat_participants cp2 ON c.id = cp2.chat_id AND cp2.user_id = $2
       WHERE c.type = 'private'`,
      [userId, otherUserId]
    );
    if (existingChat.rows.length > 0) {
      return res.status(200).json({ chatId: existingChat.rows[0].id, message: "Чат уже существует" });
    }
    const newChat = await pool.query(
      "INSERT INTO chats(type) VALUES($1) RETURNING id",
      ["private"]
    );
    const chatId = newChat.rows[0].id;
    await pool.query(
      "INSERT INTO chat_participants(chat_id, user_id) VALUES ($1, $2), ($1, $3)",
      [chatId, userId, otherUserId]
    );
       const payload = {
      type: "chat_created",
      chat_id: chatId,
      participants: [userId, otherUserId],
      createdAt: new Date().toISOString()
    };

    [userId, otherUserId].forEach(id => {
      const client = clientsMap.get(id);
      if (client && client.readyState === 1) {
        client.send(JSON.stringify(payload));
      }
    });
    res.status(201).json({ chatId, message: "Приватный чат создан" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};
export const getUserChats = async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows: chats } = await pool.query(
      `SELECT c.id AS chat_id, c.type, c.name, c.created_at
       FROM chats c
       JOIN chat_participants cp ON c.id = cp.chat_id
       WHERE cp.user_id = $1
       ORDER BY c.created_at DESC`,
      [userId]
    );

    const enrichedChats = await Promise.all(
      chats.map(async (chat) => {
        if (chat.type === "private") {
          const { rows } = await pool.query(
            `SELECT u.id, u.username, u.usersurname, u.email, u.avatar_url, u.phone
             FROM chat_participants cp
             JOIN users u ON cp.user_id = u.id
             WHERE cp.chat_id = $1 AND cp.user_id != $2`,
            [chat.chat_id, userId]
          );
          chat.otherUser = rows[0] || null;
        }
        return chat;
      })
    );
    res.json(enrichedChats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};
export const createGroupChat = async (req, res) => {
  try {
    const ownerId = req.user.id;
    const { name, participants } = req.body;

    if (!name || !Array.isArray(participants) || participants.length === 0) {
      return res.status(400).json({ message: "Нужно указать название группы и список участников" });
    }

    const emails = [...participants];
    const usersRes = await pool.query(
      `SELECT id, email FROM users WHERE email = ANY($1::text[])`,
      [emails]
    );

    const foundUsers = usersRes.rows.map(u => u.id);

    if (foundUsers.length === 0) {
      return res.status(404).json({ message: "Указанные пользователи не найдены" });
    }
    const uniqueParticipants = Array.from(new Set([...foundUsers, ownerId]));
    const chat = await pool.query(
      "INSERT INTO chats(type, name) VALUES ($1, $2) RETURNING id, created_at",
      ["group", name]
    );

    const chatId = chat.rows[0].id;
    const insertValues = uniqueParticipants.map(uid => `(${chatId}, ${uid})`).join(",");
    await pool.query(`INSERT INTO chat_participants(chat_id, user_id) VALUES ${insertValues}`);

    const payload = {
      type: "group_created",
      chat_id: chatId,
      name,
      participants: uniqueParticipants,
      created_at: new Date().toISOString(),
    };
    uniqueParticipants.forEach(uid => {
      const client = clientsMap.get(uid);
      if (client && client.readyState === 1) {
        client.send(JSON.stringify(payload));
      }
    });
    res.status(201).json({ chat_id: chatId, message: "Групповой чат создан" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};
export const leaveChat = async (req, res) => {
  const userId = req.user.id;
  const chatId = Number(req.params.chatId);

  try {
    const check = await pool.query(
      "SELECT * FROM chat_participants WHERE chat_id = $1 AND user_id = $2",
      [chatId, userId]
    );
    if (check.rows.length === 0) {
      return res.status(403).json({ message: "Вы не участвуете в этом чате" });
    }
    await pool.query(
      "DELETE FROM chat_participants WHERE chat_id = $1 AND user_id = $2",
      [chatId, userId]
    );
    const participants = await pool.query(
      "SELECT user_id FROM chat_participants WHERE chat_id = $1",
      [chatId]
    );
    const remainingCount = participants.rowCount;
    if (remainingCount === 0) {
      // await pool.query("DELETE FROM messages WHERE chat_id = $1", [chatId]);

      // Удалить вложения в MinIO (если используете)
      // TODO: добавь надёжный удалитель, если храните файлы по chat_id

      // Удалить сам чат
      await pool.query("DELETE FROM chats WHERE id = $1", [chatId]);

      return res.status(200).json({
        message: "Вы покинули чат. Чат удалён полностью, т.к. участников не осталось."
      });
    }
    const client = clientsMap.get(userId);
    if (client && client.readyState === 1) {
      const payload = {
        type: "chat_removed",
        chat_id: chatId,
      };
      client.send(JSON.stringify(payload));
    }
    res.status(200).json({
      message: "Вы покинули чат",
      remaining_participants: remainingCount,
    });
  } catch (err) {
    console.error("leaveChat error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

