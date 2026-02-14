import TelegramBot from 'node-telegram-bot-api';
import {pool} from '../db/db.js'; 

const token = process.env.TELEGRAMM_API_KEY;
const bot = new TelegramBot(token, { polling: true });
export const initTelegramBot = () => {
    console.log('Telegram bot service started...');
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, "Добро пожаловать в LiveTouch! Нажмите кнопку ниже, чтобы привязать ваш магазин к этому чату.", {
            reply_markup: {
                keyboard: [
                    [{ text: "📲 Подтвердить номер телефона", request_contact: true }]
                ],
                one_time_keyboard: true,
                resize_keyboard: true
            }
        });
    });
    bot.on('contact', async (msg) => {
        const chatId = msg.chat.id;
        const rawPhone = msg.contact.phone_number; 
        const cleanPhone = rawPhone.replace(/\D/g, ''); 
        try {
          const result = await pool.query(
                `UPDATE seller_profiles 
                 SET telegram_chat_id = $1 
                 WHERE phone LIKE $2 
                 RETURNING id, shop_name`,
                [chatId, `%${cleanPhone.slice(-10)}%`] 
            );
            if (result.rowCount > 0) {
                const shop = result.rows[0];
                bot.sendMessage(chatId, `✅ Успешно! Номер телефона привязан к магазину. Теперь сюда будут приходить уведомления о заказах.`, {
                    reply_markup: { remove_keyboard: true }
                });
                console.log(`Chat ID ${chatId} linked to shop ${shop.shop_name}`);
            } else {
                bot.sendMessage(chatId, "⚠️ Номер не найден. Убедитесь, что вы начали регистрацию на сайте и указали этот же номер.");
            }
        } catch (error) {
            console.error('Ошибка при сохранении telegram_chat_id:', error);
            bot.sendMessage(chatId, "❌ Произошла ошибка на сервере. Попробуйте позже.");
        }
    });
};

export default bot;