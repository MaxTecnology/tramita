import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Lazy init so env vars are guaranteed to be loaded before first use
let _b2: S3Client | null = null

function getClient(): S3Client {
  if (!_b2) {
    _b2 = new S3Client({
      endpoint: process.env.B2_ENDPOINT,
      region: process.env.B2_BUCKET_REGION ?? 'us-east-005',
      credentials: {
        accessKeyId: process.env.B2_KEY_ID ?? '',
        secretAccessKey: process.env.B2_APP_KEY ?? '',
      },
      forcePathStyle: true, // required for B2 S3-compatible API with custom endpoint
    })
  }
  return _b2
}

function getBucket(): string {
  return process.env.B2_BUCKET_NAME ?? 'tramita'
}

export async function uploadFile(key: string, body: Buffer, mimeType: string): Promise<void> {
  await getClient().send(new PutObjectCommand({ Bucket: getBucket(), Key: key, Body: body, ContentType: mimeType }))
}

export async function getSignedDownloadUrl(key: string, ttlSeconds = 3600): Promise<string> {
  return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: getBucket(), Key: key }), { expiresIn: ttlSeconds })
}

export async function deleteFile(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }))
}
