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
export const sendMessageNotification = async (fcmToken, title, body, data = {}) => {
  if (!fcmToken) return;
  const message = {
    token: fcmToken,
    notification: {
      title: title,
      body: body,
    },
    data: data, 
    android: {
      priority: 'high',
      notification: {
        channelId: "default", 
      },
    },
  };
  try {
    const response = await admin.messaging().send(message);
    console.log('✅ FCM пуш отправлен:', response);
    return response;
  } catch (error) {
    console.error('❌ Ошибка FCM пуша:', error);
  }
};

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
      ...callData
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