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
        username VARCHAR(50) NOT NULL,
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
        public_key TEXT,
        expo_push_token TEXT,
        fcm_token TEXT
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS chats (
        id SERIAL PRIMARY KEY,
        type VARCHAR(10) NOT NULL, 
        name VARCHAR(255),    
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_participants (
        id SERIAL PRIMARY KEY,
        chat_id INT REFERENCES chats(id) ON DELETE CASCADE,
        user_id INT NOT NULL,
        joined_at TIMESTAMP DEFAULT NOW(),
        left_at TIMESTAMP DEFAULT NULL,
        UNIQUE(chat_id, user_id)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS  messages (
        id SERIAL PRIMARY KEY,
        chat_id INT REFERENCES chats(id) ON DELETE CASCADE,
        sender_id INT REFERENCES users(id) ON DELETE SET NULL,
        recipient_id INT REFERENCES users(id) ON DELETE CASCADE,
        ciphertext TEXT NOT NULL,   
        nonce TEXT NOT NULL, 
        parent_id INT REFERENCES messages(id) ON DELETE CASCADE,  
        reply_to_id INT REFERENCES messages(id) ON DELETE SET NULL, 
        deleted_at TIMESTAMP DEFAULT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS  unread (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, chat_id)
    );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_files (
        id SERIAL PRIMARY KEY,         
        chat_id INT NOT NULL,    
        file_name VARCHAR(255) NOT NULL,
        bucket VARCHAR(50) NOT NULL,   
        created_at TIMESTAMP DEFAULT NOW()
    );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS qr_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), 
        temp_public_key TEXT NOT NULL,                
        status VARCHAR(20) DEFAULT 'pending',         
        encrypted_data TEXT,                          
        nonce TEXT,                                   
        sender_pub_key TEXT,                          
        user_id INTEGER REFERENCES users(id),         
        access_token TEXT,                            
        refresh_token TEXT,                           
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '5 minutes') 
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      image_name TEXT,
      price DECIMAL(10, 2) NOT NULL DEFAULT 0,
      quantities DECIMAL(10, 3) NOT NULL DEFAULT 0, -- Вес в кг (например, 0.500)
      image_url TEXT, -- Ссылка на фото в MinIO
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
  );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS seller_profiles (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      shop_name VARCHAR(255) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      opening_time TIME, 
      closing_time TIME, 
      payment_details TEXT, 
      telegram_chat_id BIGINT, 
      location_lat DOUBLE PRECISION,
      location_lng DOUBLE PRECISION,
      geohash VARCHAR(20),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
  );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_participant_log (
          id SERIAL PRIMARY KEY,
          chat_id INT NOT NULL,
          user_id INT NOT NULL,
          action_type VARCHAR(20) NOT NULL, -- 'join', 'leave'
          created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_log (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        ip_address VARCHAR(45) NOT NULL, -- 45 символов хватает и для IPv4, и для IPv6
        user_agent TEXT,
        action_type VARCHAR(20) DEFAULT 'login',
        created_at TIMESTAMP DEFAULT NOW()
    );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS profile_log (
          id SERIAL PRIMARY KEY,
          user_id INT REFERENCES users(id) ON DELETE CASCADE,
          field_name VARCHAR(50), -- 'username', 'avatar', 'bio'
          old_value TEXT,
          new_value TEXT,
          created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS call_logs (
          id SERIAL PRIMARY KEY,
          chat_id INTEGER,
          caller_id INTEGER,
          receiver_id INTEGER,
          started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          ended_at TIMESTAMP,
          duration INTEGER, -- в секундах
          status TEXT -- 'missed', 'completed', 'rejected'
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_seller_geohash ON seller_profiles(geohash);
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_participants_user_id ON chat_participants(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_participants_chat_id_user_id ON chat_participants(chat_id, user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_messages_deleted_at ON messages(deleted_at) WHERE deleted_at IS NULL;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats (updated_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_participant_log_user ON chat_participant_log(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_participant_log_chat ON chat_participant_log(chat_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_auth_log_user_id ON auth_log(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_auth_log_created_at ON auth_log(created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_profile_log_user ON profile_log(user_id);`);
    } catch (error) {
    console.log("Ошибка при создании таблицы:", error);
  } finally {
    client.release();
  }
}


createTable();

export { pool };
