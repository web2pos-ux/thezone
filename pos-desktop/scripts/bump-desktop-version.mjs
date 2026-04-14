/**
 * pos-desktop/package.json 의 semver 패치(마지막 숫자)를 1 올린다.
 * Electron 설치파일/포터블 파일명과 product 버전에 사용된다.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.join(__dirname, '..', 'package.json');
const raw = fs.readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(raw);
const cur = String(pkg.version || '0.0.0').trim();
const parts = cur.split('.').map((p) => parseInt(String(p).replace(/\D.*$/, ''), 10));
while (parts.length < 3) parts.push(0);
parts[2] = (Number.isFinite(parts[2]) ? parts[2] : 0) + 1;
const next = `${parts[0]}.${parts[1]}.${parts[2]}`;
pkg.version = next;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`[bump-desktop-version] ${cur} → ${next}`);
