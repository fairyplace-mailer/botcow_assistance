import { put } from '@vercel/blob';

const token = process.env.BLOB_READ_WRITE_TOKEN as string;

if (!token) {
  throw new Error('BLOB_READ_WRITE_TOKEN is not set');
}

export async function saveLog(path: string, content: string) {
  const res = await put(path, content, {
    access: 'public',
    token,
  });

  return res.url;
}
