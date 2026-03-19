import { NextResponse } from 'next/server';
import { getStorageBucket } from '@/lib/firebase-admin';

const STORAGE_PATH = 'downloads/table-order.apk';

export async function GET() {
  try {
    const bucket = getStorageBucket();
    const file = bucket.file(STORAGE_PATH);
    const [exists] = await file.exists();

    if (!exists) {
      return NextResponse.json({ filename: null });
    }

    const [metadata] = await file.getMetadata();
    const size = metadata?.size ? Number(metadata.size) : undefined;
    const downloadUrl = `https://storage.googleapis.com/${bucket.name}/${STORAGE_PATH}`;

    return NextResponse.json({
      filename: 'table-order.apk',
      size,
      downloadUrl,
    });
  } catch {
    return NextResponse.json({ filename: null });
  }
}
