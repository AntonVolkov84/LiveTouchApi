import dotenv from "dotenv";
dotenv.config();
import { Client } from 'minio';

const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT, 
  port: parseInt(process.env.MINIO_PORT),
  useSSL: process.env.MINIO_USE_SSL === "true",
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
});

async function uploadFile(bucketName, fileName, filePath) {
  await minioClient.fPutObject(bucketName, fileName, filePath);
  const fileUrl = `http://<MINIO_HOST>:9000/${bucketName}/${fileName}`;
  console.log(`File ${fileName} uploaded to bucket ${bucketName}`);
  return fileUrl;
}
export { minioClient, uploadFile };
