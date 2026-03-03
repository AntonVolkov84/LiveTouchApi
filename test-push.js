import { sendCallNotification } from './pushService.js';

// Твой токен, который ты получил на фронте
const TEST_TOKEN = "d9JiRS52Tb24KO91_UAajf:APA91bFvorIEjxbNbX6Q5sAFaMZgX4xzTx7salF71PnycS0NVEUVk6PgxJ9pKIdegCOSCKf3W9iTVvqbhwNlh4yqjjanZmF6LmL-AynUuvHzfbixVT7y3kU";
const TEST_TOKEN2 = "eu-fHmJMRtCGuTaJasoR-l:APA91bFZT1RcmVK-OL2V1nFReIRYaIKp59z5rDfjHtUQ9tCca7dD7FfWCeKM7sqrfBVa1qPMLUl-3aJaEH-dPElaVTAO7zjsizo7fbPrykOxJ_iog8jOgbk";

const testCall = async () => {
  console.log("🚀 Запуск теста пуша...");
  try {
    await sendCallNotification(TEST_TOKEN, {
      callerName: "Backend Модуль",
      chatId: "999",
      callerId: "7"
    });
    console.log("🏁 Скрипт завершен. Проверяй телефон!");
  } catch (err) {
    console.error("💥 Тест провален:", err.message);
  }
};

testCall();