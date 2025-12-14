import { v4 as uuidv4 } from 'uuid';
import { minioClient } from '../minio.js';
import { pool } from "../db/db.js"; 

export const uploadMinIO = async (req, res) => {
  const { bucket } = req.body; 
  const filename = req.body.filename;
  const allowedBuckets = ['photos', 'avatars', 'files', 'video', 'voice'];  
  if (!bucket || !allowedBuckets.includes(bucket)) {
    return res.status(400).send("Invalid or missing 'bucket' parameter.");
  }
  const file = req.file;
  if (!file) return res.status(400).send("File not provided");
  try {
    const result = await minioClient.fPutObject(bucket, filename, file.path, {  
      'Content-Type': file.mimetype
    });
    const fileUrl = `https://api.livetouch.chat/${bucket}/${filename}`; 
    res.setHeader('Cache-Control', 'no-cache');
    res.status(200).json({ message: "Uploaded!", url: fileUrl });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).send("Upload failed");
  }
};
export const addChatFile = async (req, res) => {
  try {
    const { chat_id, file_name, bucket } = req.body;
    if (!chat_id || !file_name || !bucket) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    const result = await pool.query(
      `INSERT INTO chat_files (chat_id, file_name, bucket)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [chat_id, file_name, bucket]
    );
    res.status(201).json({ message: "File added", file: result.rows[0] });
  } catch (err) {
    console.error("Error adding chat file:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};