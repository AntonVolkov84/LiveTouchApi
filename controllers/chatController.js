import { pool } from "../db/db.js"; 
import { minioClient } from '../minio.js'
import { clientsMap } from '../index.js'; 
import {sendMessageNotification} from '../pushService.js'

export const sendExpoPush = async (expoToken, title, body, data = {}, channel = "default", category = null) => {
  if (!expoToken) return;
 const message = {
  to: expoToken,
  title,
  body,
  data,
  sound: "default",
  priority: "high",
  channelId: channel,     
  categoryId: category,    
};
try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });
  } catch (error) {
    console.error("Error sending Expo push:", error);
  }
  }
export const createPrivateChat = async (req, res) => {
  try {
    const userId = req.user.id;
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email обязателен" });
    const otherUser = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (otherUser.rows.length === 0) return res.status(404).json({ message: "Пользователь не найден" });
    const otherUserId = otherUser.rows[0].id;
    const existingParticipants = await pool.query(
      `SELECT cp.chat_id, cp.user_id, cp.left_at 
       FROM chat_participants cp
       JOIN chats c ON cp.chat_id = c.id
       WHERE c.type = 'private' AND cp.chat_id IN (
         SELECT chat_id FROM chat_participants WHERE user_id = $1
         INTERSECT
         SELECT chat_id FROM chat_participants WHERE user_id = $2
       )`,
      [userId, otherUserId]
    );
    let chatId;
    let isRestored = false;
    if (existingParticipants.rows.length > 0) {
      chatId = existingParticipants.rows[0].chat_id;
      isRestored = true;
      for (const row of existingParticipants.rows) {
        if (row.left_at !== null) {
          await pool.query(
            `UPDATE chat_participants 
             SET left_at = NULL, joined_at = NOW() 
             WHERE chat_id = $1 AND user_id = $2`,
            [chatId, row.user_id]
          );
          await logParticipantAction(chatId, row.user_id, 'join');
        }
      }
    } else {
      const newChat = await pool.query("INSERT INTO chats(type) VALUES($1) RETURNING id", ["private"]);
      chatId = newChat.rows[0].id;
      await pool.query(
        "INSERT INTO chat_participants(chat_id, user_id, joined_at) VALUES ($1, $2, NOW()), ($1, $3, NOW())",
        [chatId, userId, otherUserId]
      );
      await logParticipantAction(chatId, userId, 'join');
      await logParticipantAction(chatId, otherUserId, 'join');
    }
    const payload = JSON.stringify({
      type: "chat_created",
      chat_id: chatId,
      participants: [userId, otherUserId],
      createdAt: new Date().toISOString()
    });
    [userId, otherUserId].forEach(id => {
      const userSockets = clientsMap.get(id);
      if (userSockets instanceof Set) {
        userSockets.forEach(socket => {
          if (socket.readyState === 1) socket.send(payload);
        });
      }
    });
    res.status(isRestored ? 200 : 201).json({
      chatId,
      message: isRestored ? "Чат обновлен" : "Приватный чат создан"
    });
  } catch (err) {
    console.error("createPrivateChat error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};
export const getUserChats = async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows: chats } = await pool.query(
      `SELECT c.id AS chat_id, c.type, c.name, c.created_at, c.updated_at
       FROM chats c
       JOIN chat_participants cp ON c.id = cp.chat_id
       WHERE cp.user_id = $1 AND cp.left_at IS NULL
       ORDER BY c.updated_at DESC`,
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
      `SELECT id FROM users WHERE email = ANY($1::text[])`,
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
    await pool.query(
      `INSERT INTO chat_participants (chat_id, user_id)
       SELECT $1, unnest($2::int[])`,
      [chatId, uniqueParticipants]
    );
    await Promise.all(
      uniqueParticipants.map(uid => logParticipantAction(chatId, uid, 'join'))
    );
    const payload = {
      type: "group_created",
      chat_id: chatId,
      name,
      participants: uniqueParticipants,
      created_at: new Date().toISOString(),
    };
    uniqueParticipants.forEach(uid => {
      const userSockets = clientsMap.get(uid);
      if (userSockets instanceof Set) {
        userSockets.forEach(socket => {
          if (socket.readyState === 1) {
            socket.send(JSON.stringify(payload));
          }
        });
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
      return res.status(404).json({ message: "Связь с чатом не найдена" });
    }
    await pool.query(
      "UPDATE chat_participants SET left_at = NOW() WHERE chat_id = $1 AND user_id = $2",
      [chatId, userId]
    );
    await logParticipantAction(chatId, userId, 'leave');
    const userSockets = clientsMap.get(userId);
    if (userSockets instanceof Set) {
      const payload = JSON.stringify({
        type: "chat_removed", 
        chat_id: chatId,
      });
      userSockets.forEach(socket => {
        if (socket.readyState === 1) socket.send(payload);
      });
    }
    res.status(200).json({
      message: "Чат скрыт (помечен как покинутый). Данные сохранены в архиве.",
    });
  } catch (err) {
    console.error("leaveChat error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};
export const sendMessage = async (req, res) => {
  const senderId = req.user.id;
  const { chat_id, messages, chatName, chat_type, reply_to_id } = req.body;
  if (!chat_id) return res.status(422).json({ message: "chat_id обязателен" });
  if (!Array.isArray(messages)) return res.status(422).json({ message: "messages должен быть массивом" });
  try {
    const userRes = await pool.query(
      "SELECT username, usersurname, avatar_url, public_key FROM users WHERE id = $1",
      [senderId]
    );
    const sender = userRes.rows[0];
    const { rows: participants } = await pool.query(
      "SELECT user_id, left_at FROM chat_participants WHERE chat_id = $1",
      [chat_id]
    );
    const activeParticipants = participants.filter(p => p.left_at === null);
    const participantIds = activeParticipants.map(p => p.user_id).filter(id => id !== senderId);
    if (participantIds.length > 0) {
    const { rows: alreadyUnread } = await pool.query(
        `SELECT user_id FROM unread WHERE chat_id = $1 AND user_id = ANY($2)`,
        [chat_id, participantIds]
    );
    const alreadyUnreadIds = alreadyUnread.map(r => r.user_id);
    const idsToNotify = participantIds.filter(id => !alreadyUnreadIds.includes(id));
    if (idsToNotify.length > 0) {
        const { rows: tokenRows } = await pool.query(
            `SELECT id, fcm_token, expo_push_token FROM users WHERE id = ANY($1)`,
            [idsToNotify]
        );
        const fcmTargets = [];
        const expoTokens = [];
        tokenRows.forEach(user => {
        if (user.fcm_token) {
          fcmTargets.push(user.fcm_token);
        } else if (user.expo_push_token && user.expo_push_token.startsWith("ExponentPushToken")) {
          expoTokens.push(user.expo_push_token);
        }
        });
        const title = chat_type === "group" ? chatName : `${sender.usersurname} ${sender.username}`;
        const body = "Получено новое сообщение";
        const pushData = { chat_id: String(chat_id), type: "message_new" };   
        if (fcmTargets.length > 0) {
        fcmTargets.forEach(token => {
            sendMessageNotification(token, title, body, pushData)
                .catch(err => console.error(`FCM Error for token ${token}:`, err));
        });
        }
        if (expoTokens.length > 0) {
            sendExpoPush(expoTokens, title, body, pushData);
        }
    }
}
    let parentId = null;
    const insertedRows = [];
    let finalReplyToId = reply_to_id; 
    if (reply_to_id) {
      const { rows: replySource } = await pool.query(
        "SELECT id, parent_id FROM messages WHERE id = $1",
        [reply_to_id]
      );
      if (replySource.length > 0) {
        finalReplyToId = replySource[0].parent_id || replySource[0].id;
      }
    }
    for (const msg of messages) {
      const insertRes = await pool.query(
          `INSERT INTO messages (chat_id, sender_id, recipient_id, ciphertext, nonce, parent_id, reply_to_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [chat_id, senderId, msg.user_id, msg.ciphertext, msg.nonce, parentId, finalReplyToId])
      let row = insertRes.rows[0];
      if (!parentId) {
          parentId = row.id;
          const updateRes = await pool.query(
            `UPDATE messages SET parent_id = $1 WHERE id = $1 RETURNING *`,
            [parentId]
          );
          row = updateRes.rows[0]
        }
      insertedRows.push({
        id: row.id,
        parent_id: row.parent_id,
        user_id: msg.user_id,      
        reply_to_id: finalReplyToId, 
        ciphertext: row.ciphertext,
        nonce: row.nonce,
        created_at: row.created_at
      });
    }
    try {
      await pool.query(
        "UPDATE chats SET updated_at = NOW() WHERE id = $1",
        [chat_id]
      );
    } catch (updateErr) {
     console.error("Ошибка обновления updated_at чата:", updateErr);
    }
    if (participantIds.length > 0) {
      const values = participantIds.map(id => `(${id}, ${chat_id})`).join(",");
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
      sender_public_key: sender.public_key,
      reply_to_id: finalReplyToId || null,
      created_at: insertedRows[0]?.created_at || new Date().toISOString(),
      messages: insertedRows     
    };
    activeParticipants.forEach(({ user_id }) => {
      const sockets = clientsMap.get(user_id);
      if (sockets) {
        sockets.forEach(s => {
          if (s.readyState === 1) s.send(JSON.stringify(payload));
        });
      }
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
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 20; 
    const offset = parseInt(req.query.offset) || 0;
    if (!chat_id) {
      return res.status(422).json({ message: "chat_id required" });
    }
    const result = await pool.query(
      `SELECT m.id, m.recipient_id, m.chat_id, m.sender_id, m.parent_id, m.ciphertext, m.nonce, m.created_at, m.updated_at, m.reply_to_id,
              u.username AS sender_name, u.usersurname AS sender_surname, u.avatar_url AS sender_avatar, u.public_key AS sender_public_key 
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.chat_id = $1 
         AND m.recipient_id = $2
         AND m.deleted_at IS NULL
         -- ВОТ ЭТОТ КУСОК ОГРАНИЧИВАЕТ ИСТОРИЮ:
         AND m.created_at >= (
            SELECT COALESCE(MAX(created_at), '1970-01-01') 
            FROM chat_participant_log 
            WHERE chat_id = $1 AND user_id = $2 AND action_type = 'join'
         )
       ORDER BY m.created_at DESC
       LIMIT $3 OFFSET $4`,
      [chat_id, userId, limit, offset]
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
      `SELECT u.id, u.username, u.usersurname, u.public_key, u.avatar_url
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
    const userRes = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (userRes.rowCount === 0) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }
    const newUserId = userRes.rows[0].id;
    const insertRes = await pool.query(
      `INSERT INTO chat_participants (chat_id, user_id, joined_at, left_at)
       VALUES ($1, $2, NOW(), NULL)
       ON CONFLICT (chat_id, user_id) 
       DO UPDATE SET 
         left_at = NULL, 
         joined_at = NOW() 
       RETURNING left_at`,
      [chat_id, newUserId]
    );
    await logParticipantAction(chat_id, newUserId, 'join');
    const payload = {
      type: "add_participant",
      chat_id,
      created_at: created_at || new Date().toISOString(),
      name: groupName,
      chat_type
    };
    const userSockets = clientsMap.get(newUserId);
    if (userSockets instanceof Set) {
      userSockets.forEach(socket => {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify(payload));
        }
      });
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
      `SELECT u.chat_id
       FROM unread u
       JOIN chat_participants cp ON u.chat_id = cp.chat_id AND u.user_id = cp.user_id
       WHERE u.user_id = $1 AND cp.left_at IS NULL`, 
      [userId]
    );
    const unreadIds = rows.map(r => r.chat_id);
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
export const updateMessage = async (req, res) => {
  const userId = req.user.id;
  const messageId = Number(req.params.messageId);
  const {messages } = req.body;
  if (!Array.isArray(messages)) {
    return res.status(422).json({ message: "Поле messages (массив) обязательно" });
  }
  try {
    const { rows } = await pool.query(
      `SELECT m.chat_id, m.sender_id, m.deleted_at, m.parent_id, c.type 
       FROM messages m 
       JOIN chats c ON m.chat_id = c.id 
       WHERE m.id = $1`,
      [messageId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "Сообщение не найдено" });
    }
    const message = rows[0];
     if (message.deleted_at) {
      return res.status(400).json({ message: "Нельзя редактировать удаленное сообщение" });
    }
    if (message.sender_id !== userId) return res.status(403).json({ message: "Нет прав" });
    const rootId = message.parent_id || message.id;
    const { rows: senderRows } = await pool.query(
      "SELECT username, usersurname, avatar_url, public_key FROM users WHERE id = $1",
      [userId]
    );
    const sender = senderRows[0];
    const updatedMessages = [];
        for (const msg of messages) {
        const { rows: updatedRows } = await pool.query(
          `UPDATE messages
          SET ciphertext = $1, nonce = $2, updated_at = NOW()
          WHERE (id = $3 OR parent_id = $3) AND recipient_id = $4
          RETURNING *`,
          [msg.ciphertext, msg.nonce, rootId, msg.recipient_id] 
        );
        const updated = updatedRows[0];
        if (updated) {
          updatedMessages.push({
          ...updated,
          user_id: msg.recipient_id,
          sender_id: userId,        
          sender_name: sender.username,
          sender_surname: sender.usersurname,
          sender_avatar: sender.avatar_url,
          sender_public_key: sender.public_key
        });
      }
      }
      const payload = {
        type: "message_updated",
        chat_id: message.chat_id,
        messages: updatedMessages
      };
      const { rows: participants } = await pool.query(
      "SELECT user_id FROM chat_participants WHERE chat_id = $1",
      [message.chat_id]
    );
    participants.forEach(p => {
      const sockets = clientsMap.get(p.user_id); 
      if (sockets) {
        sockets.forEach(s => { if (s.readyState === 1) s.send(JSON.stringify(payload)); });
      }
    });
    return res.status(200).json({ status: "ok", updated: updatedMessages });
  } catch (err) {
    console.error("updateMessage error:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};
export const deleteMessageAllParticipants = async (req, res) => {
  const userId = req.user.id;
  const messageId = Number(req.params.messageId);
  try {
    const { rows } = await pool.query(
      "SELECT chat_id, sender_id, parent_id FROM messages WHERE id = $1",
      [messageId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "Сообщение не найдено" });
    }
    const message = rows[0];
    if (message.sender_id !== userId) {
      return res.status(403).json({ message: "Нет прав на удаление сообщения" });
    }
    const targetId = message.parent_id || messageId;
    await pool.query(
      "UPDATE messages SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 OR parent_id = $1", 
      [targetId]
    );
    const { rows: participants } = await pool.query(
      "SELECT user_id FROM chat_participants WHERE chat_id = $1",
      [message.chat_id]
    );
    const payload = {
      type: "message_deleted",
      chat_id: message.chat_id,
      message_id: targetId, 
    };
    participants.forEach(p => {
      const sockets = clientsMap.get(p.user_id);
      if (sockets) {
        sockets.forEach(s => {
          if (s.readyState === 1) s.send(JSON.stringify(payload));
        });
      }
    });
    res.status(200).json({ message: "Сообщение удалено (архивировано)" });
  } catch (err) {
    console.error("deleteMessage error:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};
export const deleteMessageForMe = async (req, res) => {
  const userId = req.user.id;
  const messageId = Number(req.params.messageId);
  console.log(userId, messageId)
  try {
    const { rowCount } = await pool.query(
      "UPDATE messages SET deleted_at = NOW() WHERE id = $1 AND recipient_id = $2",
      [messageId, userId]
    );
    if (rowCount === 0) {
      return res.status(404).json({ message: "Сообщение не найдено или уже удалено" });
    }
    res.status(200).json({ message: "Сообщение удалено у вас" });
  } catch (err) {
    res.status(500).json({ message: "Ошибка сервера" });
  }
};
const logParticipantAction = async (chatId, userId, action) => {
  try {
    await pool.query(
      "INSERT INTO chat_participant_log (chat_id, user_id, action_type) VALUES ($1, $2, $3)",
      [chatId, userId, action]
    );
  } catch (err) {
    console.error("Audit Log Error:", err);
  }
};

export const declineCall = async (req, res) => {
  const { chatId, sender, target } = req.body;
  try {
    await pool.query(
      `UPDATE call_logs SET status = 'missed', ended_at = CURRENT_TIMESTAMP 
       WHERE chat_id = $1 AND ended_at IS NULL`,
      [chatId]
    );
    const targetIdNum = Number(target);
    const targetIdStr = String(target);
    const targetDevices = clientsMap.get(targetIdNum) || clientsMap.get(targetIdStr);
    if (targetDevices && targetDevices instanceof Set) {
      const payload = JSON.stringify({ 
        type: "call-ended", 
        chatId: Number(chatId), 
        sender: Number(sender) 
      });
      targetDevices.forEach(socket => {
        if (socket.readyState === 1) {
          socket.send(payload);
        } else {
          console.log("⚠️ Сокет найден, но он не в readyState 1");
        }
      });
    } else {
      console.log(`❌ Юзер ${target} не найден в clientsMap. Доступные ID:`, Array.from(clientsMap.keys()));
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("Ошибка в declineCall:", e);
    res.status(500).send(e.message);
  }
};