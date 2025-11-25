import dotenv from "dotenv";
dotenv.config();
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function createTable() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        usersurname VARCHAR(50) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        avatar_url TEXT,
        bio TEXT,
        phone VARCHAR(20),
        is_verified BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        role VARCHAR(20) DEFAULT 'user',
        email_confirm_token text NULL,
        forgot_password_token TEXT,
        forgot_password_hashed TEXT,
        forgot_password_expires TIMESTAMP,
        last_login TIMESTAMP,
        is_online BOOLEAN DEFAULT FALSE,
        last_seen TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        public_key TEXT
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS chats (
        id SERIAL PRIMARY KEY,
        type VARCHAR(10) NOT NULL, 
        name VARCHAR(255),    
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_participants (
        id SERIAL PRIMARY KEY,
        chat_id INT REFERENCES chats(id) ON DELETE CASCADE,
        user_id INT NOT NULL,
        UNIQUE(chat_id, user_id),
        public_key TEXT
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS  messages (
        id SERIAL PRIMARY KEY,
        chat_id INT REFERENCES chats(id) ON DELETE CASCADE,
        sender_id INT REFERENCES users(id) ON DELETE SET NULL,
        ciphertext TEXT NOT NULL,   
        nonce TEXT NOT NULL,      
        created_at TIMESTAMP DEFAULT NOW()
    );
    `);
  } catch (error) {
    console.log("Ошибка при создании таблицы:", error);
  } finally {
    client.release();
  }
}


createTable();

export { pool };
