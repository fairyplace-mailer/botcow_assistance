import { NextResponse } from 'next/server';
import { saveLog } from '../../../backend/blob';

export async function POST(req: Request) {
  const { path, content } = await req.json();

  if (!path || typeof path !== 'string') {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const logContent =
    typeof content === 'string' ? content : JSON.stringify(content, null, 2);

  const result = await saveLog(path, logContent);
  return NextResponse.json({ url: result });
}
