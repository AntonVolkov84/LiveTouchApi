import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_FILE = path.join(__dirname, '../logs/LiveTouchErrors.log');

const logDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

export const postLog = (req, res) => {
  try {
    const payload = req.body;
    if (!payload.message || !payload.timestamp) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const logLine = `[${payload.timestamp}] [${payload.functionName || 'unknown'}] ${payload.message} | ${JSON.stringify(payload.error ?? 'no error')}\n`;
    fs.appendFileSync(LOG_FILE, logLine, { encoding: 'utf-8' });
    return res.status(200).json({ status: 'ok', path: LOG_FILE });
  } catch (err) {
    console.error('Error writing log:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
