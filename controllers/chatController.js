import { pool } from "../db/db.js"; 
import { minioClient } from '../minio.js'
import { clientsMap } from '../index.js'; 
import fetch from "node-fetch";



export const sendExpoPush = async (expoToken, title, body, data = {}) => {
  if (!expoToken) {
    console.log("Invalid expo token:", expoToken);
    return;
  }
  const message = {
    to: expoToken,
    sound: "default",
    title,
    body,
    data,
     android: {
    channelId: "default",
  },
  };
  try{
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });
}catch(error){
  console.log("sendExpoPush", error)
}}



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
            `SELECT u.id, u.username, u.usersurname, u.email, u.avatar_url, u.phone, u.public_key
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
      `SELECT id, email FROM users WHERE email = ANY(ARRAY(SELECT unnest($1::text[])))`,
      [participants]
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
      const filesRes = await pool.query("SELECT * FROM chat_files WHERE chat_id = $1", [chatId]);
      const files = filesRes.rows;
      await Promise.all(
        files.map(f => minioClient.removeObject(f.bucket, f.file_name))
      );
      await pool.query("DELETE FROM chat_files WHERE chat_id = $1", [chatId]);
      await pool.query("DELETE FROM chats WHERE id = $1", [chatId]);
      const client = clientsMap.get(userId);
        if (client && client.readyState === 1) {
          client.send(JSON.stringify({
            type: "chat_removed",
            chat_id: chatId
          }));
        }

      return res.status(200).json({
        message: "Вы покинули чат. Чат удалён полностью, т.к. участников не осталось."
      });
    }
    console.log(clientsMap)
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
export const sendMessage = async (req, res) => {
  const senderId = req.user.id;
  const { chat_id, ciphertext, nonce, messages, chatName } = req.body;
  if (!chat_id) return res.status(422).json({ message: "chat_id обязателен" });
  try {
    const chatRes = await pool.query(
      "SELECT type FROM chats WHERE id = $1",
      [chat_id]
    );
    if (chatRes.rows.length === 0)
      return res.status(404).json({ message: "Чат не найден" });
    const chatType = chatRes.rows[0].type;
    const userRes = await pool.query(
      "SELECT username, usersurname, avatar_url FROM users WHERE id = $1",
      [senderId]
    );
    const sender = userRes.rows[0];
    const { rows: participants } = await pool.query(
      "SELECT user_id FROM chat_participants WHERE chat_id = $1",
      [chat_id]
    );
    const participantIds = participants.map(p => p.user_id).filter(id => id !== senderId);
    const { rows: tokenRows } = await pool.query(
      `SELECT expo_push_token FROM users WHERE id = ANY($1)`,
      [participantIds]
    );
    const expoTokens = tokenRows
      .map(u => u.expo_push_token)
      .filter(t => t && t.startsWith("ExponentPushToken"));
    if (expoTokens.length > 0) {
      const title = messages
        ? `${chatName}`
        : `${sender.usersurname} ${sender.username}`;
      const body = "Получено новое сообщение";
      sendExpoPush(expoTokens, title, body, {chat_id,
              type: "message_new"})
      }
    

    // ============================================================
    //                     PRIVATE CHAT
    // ============================================================
    if (chatType === "private") {
      if (!ciphertext || !nonce)
        return res.status(422).json({ message: "ciphertext и nonce обязательны" });

      const insertRes = await pool.query(
        `INSERT INTO messages (chat_id, sender_id, ciphertext, nonce)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [chat_id, senderId, ciphertext, nonce]
      );

      const msg = insertRes.rows[0];

      const otherParticipant = participants.find(p => p.user_id !== senderId);
      if (otherParticipant) {
        await pool.query(
          `INSERT INTO unread(user_id, chat_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING`,
          [otherParticipant.user_id, chat_id]
        );
      }

      const payload = {
        type: "message_new",
        chat_id,
        id: msg.id,
        sender_id: senderId,
        sender_name: sender.username,
        sender_surname: sender.usersurname,
        sender_avatar: sender.avatar_url,
        ciphertext,
        nonce,
        created_at: msg.created_at,
      };
      participants.forEach(({ user_id }) => {
        const ws = clientsMap.get(user_id);
        if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
      });

      return res.status(200).json(msg);
    }

    // ============================================================
    //                      GROUP CHAT
    // ============================================================
    if (!Array.isArray(messages)) {
      return res.status(422).json({ message: "messages обязателен для группы" });
    }

    const insertedRows = [];
    for (const msg of messages) {
      const ins = await pool.query(
        `INSERT INTO messages (chat_id, sender_id, user_id, ciphertext, nonce)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *`,
        [chat_id, senderId, msg.user_id, msg.ciphertext, msg.nonce] 
      );
      const row = ins.rows[0];
      insertedRows.push({
        id: row.id,
        user_id: msg.user_id,       
        ciphertext: row.ciphertext,
        nonce: row.nonce
      });
    }

    const otherParticipantIds = participants
  .map(p => p.user_id)
  .filter(id => id !== senderId);

    if (otherParticipantIds.length > 0) {
      const values = otherParticipantIds.map(id => `(${id}, ${chat_id})`).join(",");
      await pool.query(
        `INSERT INTO unread(user_id, chat_id)
        VALUES ${values}
        ON CONFLICT DO NOTHING`
      );
    }

    const payload = {
      type: "message_new",
      chat_id,
      sender_id: senderId,
      sender_name: sender.username,
      sender_surname: sender.usersurname,
      sender_avatar: sender.avatar_url,
      created_at: new Date().toISOString(),
      messages: insertedRows     
    };

    participants.forEach(({ user_id }) => {
      const ws = clientsMap.get(user_id);
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
    });

    return res.status(200).json({ status: "ok", inserted: insertedRows });

  } catch (err) {
    console.error("sendMessage error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

export const getMessages = async (req, res) => {
  try {
    const { chat_id } = req.params;
    if (!chat_id) {
      return res.status(422).json({ message: "chat_id required" });
    }
    const result = await pool.query(
      `SELECT m.id, m.user_id, m.chat_id, m.sender_id, m.ciphertext, m.nonce, m.created_at,
              u.username AS sender_name, u.usersurname AS sender_surname, u.avatar_url AS sender_avatar 
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.chat_id = $1
       ORDER BY m.created_at ASC`,
      [chat_id]
    );
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("getMessages error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};
export const getChatParticipants = async (req, res) => {
  try {
    const { chat_id } = req.params;
    if (!chat_id) {
      return res.status(400).json({ message: "chat_id не указан" });
    }
    const result = await pool.query(
      `SELECT u.id, u.username, u.usersurname, u.public_key
       FROM chat_participants cp
       JOIN users u ON cp.user_id = u.id
       WHERE cp.chat_id = $1`,
      [chat_id]
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("getChatParticipants error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};
export const addParticipant = async (req, res) => {
  try {
    const { email, chat_id, created_at, groupName, chat_type } = req.body;
    if (!email || !chat_id) {
      return res.status(400).json({ error: "email и chat_id обязательны" });
    }
    const userRes = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );
    if (userRes.rowCount === 0) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }
    const newUserId = userRes.rows[0].id;
    const participantRes = await pool.query(
      "SELECT user_id FROM chat_participants WHERE chat_id = $1 AND user_id = $2",
      [chat_id, newUserId]
    );
    if (participantRes.rowCount > 0) {
      return res.status(409).json({ error: "Пользователь уже в чате" });
    }
    await pool.query(
      `INSERT INTO chat_participants (chat_id, user_id)
       VALUES ($1, $2)`,
      [chat_id, newUserId]
    );
    const payload = {
        type: "add_participant",
        chat_id,
        created_at,
        name: groupName,
        chat_type
      };
    
    const ws = clientsMap.get(newUserId);
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(payload));
      }
    return res.status(200).json({
      status: "ok",
      user_id: newUserId,
      chat_id,
    });
  } catch (err) {
    console.error("Ошибка addParticipant:", err);
    return res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
};

export const getUnread = async (req, res) => {
  const userId = req.user.id;
  try {
    const { rows } = await pool.query(
      `SELECT chat_id
       FROM unread
       WHERE user_id = $1`,
      [userId]
    );
    const unreadIds = rows.length > 0 ? rows.map(r => r.chat_id) : [];
    res.status(200).json({ unread: unreadIds });
  } catch (err) {
    console.error("getUnread error:", err);
    res.status(500).json({ error: "Server error" });
  }
};
export const clearChatUnread = async (req, res) => {
  const userId = req.user.id;
  const chatId = Number(req.params.chatId);
  try {
    await pool.query(
      `DELETE FROM unread
       WHERE user_id = $1 AND chat_id = $2`,
      [userId, chatId]
    );
    res.json({ status: "ok" });
  } catch (err) {
    console.error("clearChatUnread error:", err);
    res.status(500).json({ error: "Server error" });
  }
};
export const clearAllUnread = async (req, res) => {
  const userId = req.user.id;
  try {
    await pool.query(
      `DELETE FROM unread
       WHERE user_id = $1`,
      [userId]
    );
    res.json({ status: "ok" });
  } catch (err) {
    console.error("clearAllUnread error:", err);
    res.status(500).json({ error: "Server error" });
  }
};
export const deleteMessage = async (req, res) => {
  const userId = req.user.id;
  const messageId = Number(req.params.messageId);
  try {
    const { rows } = await pool.query(
      "SELECT chat_id, sender_id FROM messages WHERE id = $1",
      [messageId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "Сообщение не найдено" });
    }
    const message = rows[0];
    if (message.sender_id !== userId) {
      return res.status(403).json({ message: "Нет прав на удаление сообщения" });
    }
    await pool.query("DELETE FROM messages WHERE id = $1", [messageId]);
    const { rows: participants } = await pool.query(
      "SELECT user_id FROM chat_participants WHERE chat_id = $1",
      [message.chat_id]
    );
    const payload = {
      type: "message_deleted",
      chat_id: message.chat_id,
      message_id: messageId,
    };
    participants.forEach(p => {
      const client = clientsMap.get(p.user_id);
      if (client && client.readyState === 1) {
        client.send(JSON.stringify(payload));
      }
    });
    res.status(200).json({ message: "Сообщение удалено" });
  } catch (err) {
    console.error("deleteMessage error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};
export const updateMessage = async (req, res) => {
  const userId = req.user.id;
  const messageId = Number(req.params.messageId);
  const { ciphertext, nonce, messages } = req.body;
  if (!ciphertext && !messages) {
    return res.status(422).json({ message: "ciphertext или messages обязательны" });
  }
  try {
    const { rows } = await pool.query(
      `SELECT m.chat_id, m.sender_id, c.type 
       FROM messages m 
       JOIN chats c ON m.chat_id = c.id 
       WHERE m.id = $1`,
      [messageId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "Сообщение не найдено" });
    }
    const message = rows[0];
    if (message.sender_id !== userId) {
      return res.status(403).json({ message: "Нет прав на редактирование сообщения" });
    }
    // ==== Данные отправителя ====
    const { rows: senderRows } = await pool.query(
      "SELECT username, usersurname, avatar_url FROM users WHERE id = $1",
      [userId]
    );
    const sender = senderRows[0];
    // ==== Участники ====
    const { rows: participants } = await pool.query(
      "SELECT user_id FROM chat_participants WHERE chat_id = $1",
      [message.chat_id]
    );
    // ===================================================================
    // PRIVATE
    // ===================================================================
    if (message.type === "private") {
      const { rows: updatedRows } = await pool.query(
        `UPDATE messages 
         SET ciphertext = $1, nonce = $2
         WHERE id = $3
         RETURNING *`,
        [ciphertext, nonce, messageId]
      );
      const updated = updatedRows[0];
      const payload = {
        type: "message_updated",
        chat_id: message.chat_id,
        message: {
          ...updated,
          sender_name: sender.username,
          sender_surname: sender.usersurname,
          sender_avatar: sender.avatar_url
        }
      };
      participants.forEach(p => {
        const client = clientsMap.get(p.user_id);
        if (client && client.readyState === 1) client.send(JSON.stringify(payload));
      });
      return res.status(200).json(updated);
    }

    // ===================================================================
    // GROUP
    // ===================================================================
    if (message.type === "group" && Array.isArray(messages)) {
      const updatedMessages = [];

      for (const msg of messages) {
        const { rows: updatedRows } = await pool.query(
          `UPDATE messages
           SET ciphertext = $1, nonce = $2
           WHERE id = $3
           RETURNING *`,
          [msg.ciphertext, msg.nonce, msg.id]
        );

        const updated = updatedRows[0];

        updatedMessages.push({
          ...updated,
          user_id: msg.user_id,        
          sender_name: sender.username,
          sender_surname: sender.usersurname,
          sender_avatar: sender.avatar_url
        });
      }

      const payload = {
        type: "message_updated",
        chat_id: message.chat_id,
        messages: updatedMessages
      };

      participants.forEach(p => {
        const client = clientsMap.get(p.user_id);
        if (client && client.readyState === 1) client.send(JSON.stringify(payload));
      });

      return res.status(200).json({ status: "ok", updated: updatedMessages });
    }

    return res.status(400).json({ message: "Невозможно обновить сообщение" });

  } catch (err) {
    console.error("updateMessage error:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};

