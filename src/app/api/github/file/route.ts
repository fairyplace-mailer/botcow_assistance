import { NextResponse } from 'next/server';
import { getFile } from '../../../../backend/github';

export async function POST(req: Request) {
  const { path, repo } = await req.json();

  if (!path || typeof path !== 'string') {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  try {
    const content = await getFile(path, repo);
    return NextResponse.json({ content });
    } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error('GitHub read failed');

    return NextResponse.json(
      { error: err.message },
      { status: 500 },
    );
  }
}
