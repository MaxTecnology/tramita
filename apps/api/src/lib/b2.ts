import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
} from '@aws-sdk/client-s3'
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

export async function downloadFile(key: string): Promise<Buffer> {
  const response = await getClient().send(new GetObjectCommand({ Bucket: getBucket(), Key: key }))
  const chunks: Uint8Array[] = []
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) chunks.push(chunk)
  return Buffer.concat(chunks)
}

export async function deleteFile(key: string): Promise<void> {
  if (!key) throw new Error('deleteFile: key vazia — Prefix vazio no ListObjectVersionsCommand listaria o bucket inteiro')

  const bucket = getBucket()
  const client = getClient()

  // List all versions and delete markers for this key — required for versioned buckets
  const listed = await client.send(
    new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key }),
  )

  // Prefix não é correspondência exata — filtra por Key === key pra nunca apagar um objeto que só
  // comece com o mesmo prefixo (defesa em profundidade além da guarda de key vazia acima).
  const toDelete = [
    ...(listed.Versions ?? []).filter((v) => v.Key === key).map((v) => ({ Key: v.Key!, VersionId: v.VersionId })),
    ...(listed.DeleteMarkers ?? []).filter((v) => v.Key === key).map((v) => ({ Key: v.Key!, VersionId: v.VersionId })),
  ]

  if (toDelete.length === 0) {
    // Bucket without versioning — simple delete
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    return
  }

  await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: toDelete } }))
}
