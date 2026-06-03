import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export const b2 = new S3Client({
  endpoint: process.env.B2_ENDPOINT ?? 'https://s3.us-west-004.backblazeb2.com',
  region: process.env.B2_BUCKET_REGION ?? 'us-west-004',
  credentials: {
    accessKeyId: process.env.B2_KEY_ID ?? '',
    secretAccessKey: process.env.B2_APP_KEY ?? '',
  },
})

const BUCKET = process.env.B2_BUCKET_NAME ?? 'tramita'

export async function uploadFile(key: string, body: Buffer, mimeType: string): Promise<void> {
  await b2.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: mimeType }))
}

export async function getSignedDownloadUrl(key: string, ttlSeconds = 3600): Promise<string> {
  return getSignedUrl(b2, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: ttlSeconds })
}

export async function deleteFile(key: string): Promise<void> {
  await b2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}
