# Web2POS Download Site

Simple download page for the Table Order Android APK. Uses **Firebase Storage** for persistent file storage.

## Setup

1. Copy `.env.example` to `.env.local`
2. Set `ADMIN_PASSWORD` for the upload feature
3. **Firebase** (pick one):
   - **Local dev**: Uses `../backend/config/firebase-service-account.json` automatically (same as web2pos)
   - **Vercel**: Set `FIREBASE_SERVICE_ACCOUNT` env = full service account JSON as single line
4. Run `npm install` then `npm run dev`

## Firebase Storage

- APK is stored at `downloads/table-order.apk` in your Firebase Storage bucket
- Uses the same project as web2pos (`ezorder-platform`)
- File is made public for direct download

## Deploy (Vercel)

1. Add environment variables in Vercel:
   - `ADMIN_PASSWORD`
   - `FIREBASE_SERVICE_ACCOUNT` (full JSON as string)
2. Deploy: `vercel --prod`
3. Connect domain: web2pos.com

## Routes

- `/` - Redirects to `/download`
- `/download` - Download page (users download from Firebase, admins upload to Firebase)
