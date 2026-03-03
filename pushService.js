import admin from 'firebase-admin';
import { readFile } from 'fs/promises';

const serviceAccount = JSON.parse(
  await readFile(new URL('./service-account.json', import.meta.url))
);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export const sendCallNotification = async (targetToken, callData) => {
  const message = {
    token: targetToken,
    android: {
      priority: 'high',
      ttl: 0,
          },
    data: {
      channelId: "calls-fixed-v72",
      display_title: 'Входящий вызов',
      display_body: `${callData.callerName} звонит вам...`,
      callerName: String(callData.callerName),
      chatId: String(callData.chatId),
      type: 'INCOMING_CALL',
    },
  };
  try {
    const response = await admin.messaging().send(message);
    console.log('✅ Пуш успешно отправлен:', response);
    return response;
  } catch (error) {
    console.error('❌ Ошибка отправки пуша:', error);
    throw error;
  }
};