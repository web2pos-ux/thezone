import { NextRequest, NextResponse } from 'next/server';
import { getStorageBucket } from '@/lib/firebase-admin';

const STORAGE_PATH = 'downloads/table-order.apk';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const password = formData.get('password') as string;
    const file = formData.get('file') as File;

    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      return NextResponse.json({ success: false, error: 'Server not configured' }, { status: 500 });
    }
    if (password !== adminPassword) {
      return NextResponse.json({ success: false, error: 'Invalid password' }, { status: 401 });
    }
    if (!file || !file.name.toLowerCase().endsWith('.apk')) {
      return NextResponse.json({ success: false, error: 'Invalid file. Please upload an APK file.' }, { status: 400 });
    }

    const bucket = getStorageBucket();
    const storageFile = bucket.file(STORAGE_PATH);
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    await storageFile.save(buffer, {
      metadata: { contentType: 'application/vnd.android.package-archive' },
    });
    await storageFile.makePublic();

    const [metadata] = await storageFile.getMetadata();
    const size = metadata.size || buffer.length;

    return NextResponse.json({
      success: true,
      filename: 'table-order.apk',
      size: Number(size),
      downloadUrl: `https://storage.googleapis.com/${bucket.name}/${STORAGE_PATH}`,
    });
  } catch (e) {
    console.error('[upload]', e);
    return NextResponse.json({ success: false, error: 'Upload failed' }, { status: 500 });
  }
}
