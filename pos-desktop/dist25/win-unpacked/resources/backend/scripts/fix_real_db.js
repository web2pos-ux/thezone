// 실제 서버가 사용하는 DB 파일을 수정하는 스크립트
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 서버가 사용하는 실제 DB 경로
const dbPath = path.resolve('C:\\Users\\Luckyhan\\web2pos\\db\\web2pos.db');
console.log('DB 경로:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('DB 연결 실패:', err.message);
        process.exit(1);
    }
    console.log('DB 연결 성공');
    
    db.serialize(() => {
        // 1. 기존 테이블 삭제
        console.log('\n=== 기존 테이블 삭제 ===');
        db.run('DROP TABLE IF EXISTS printer_group_links', (err) => {
            if (err) console.error('  printer_group_links 삭제 실패:', err.message);
            else console.log('  printer_group_links 삭제 완료');
        });
        db.run('DROP TABLE IF EXISTS tax_group_links', (err) => {
            if (err) console.error('  tax_group_links 삭제 실패:', err.message);
            else console.log('  tax_group_links 삭제 완료');
        });
        db.run('DROP TABLE IF EXISTS printers', (err) => {
            if (err) console.error('  printers 삭제 실패:', err.message);
            else console.log('  printers 삭제 완료');
        });
        db.run('DROP TABLE IF EXISTS printer_groups', (err) => {
            if (err) console.error('  printer_groups 삭제 실패:', err.message);
            else console.log('  printer_groups 삭제 완료');
        });
        db.run('DROP TABLE IF EXISTS taxes', (err) => {
            if (err) console.error('  taxes 삭제 실패:', err.message);
            else console.log('  taxes 삭제 완료');
        });
        db.run('DROP TABLE IF EXISTS tax_groups', (err) => {
            if (err) console.error('  tax_groups 삭제 실패:', err.message);
            else console.log('  tax_groups 삭제 완료');
        });

        // 2. 새 테이블 생성
        console.log('\n=== 새 테이블 생성 ===');
        db.run(`CREATE TABLE printers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL DEFAULT '',
            type TEXT DEFAULT '',
            selected_printer TEXT DEFAULT '',
            sort_order INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) console.error('  printers 생성 실패:', err.message);
            else console.log('  printers 생성 완료');
        });

        db.run(`CREATE TABLE printer_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) console.error('  printer_groups 생성 실패:', err.message);
            else console.log('  printer_groups 생성 완료');
        });

        db.run(`CREATE TABLE printer_group_links (
            group_id INTEGER NOT NULL,
            printer_id INTEGER NOT NULL,
            PRIMARY KEY (group_id, printer_id)
        )`, (err) => {
            if (err) console.error('  printer_group_links 생성 실패:', err.message);
            else console.log('  printer_group_links 생성 완료');
        });

        db.run(`CREATE TABLE taxes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            rate REAL NOT NULL,
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) console.error('  taxes 생성 실패:', err.message);
            else console.log('  taxes 생성 완료');
        });

        db.run(`CREATE TABLE tax_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) console.error('  tax_groups 생성 실패:', err.message);
            else console.log('  tax_groups 생성 완료');
        });

        db.run(`CREATE TABLE tax_group_links (
            group_id INTEGER NOT NULL,
            tax_id INTEGER NOT NULL,
            PRIMARY KEY (group_id, tax_id)
        )`, (err) => {
            if (err) console.error('  tax_group_links 생성 실패:', err.message);
            else console.log('  tax_group_links 생성 완료');
        });

        // 3. 확인
        setTimeout(() => {
            console.log('\n=== 최종 스키마 확인 ===');
            db.all('PRAGMA table_info(printers)', (err, rows) => {
                console.log('printers 컬럼:', rows ? rows.map(r => r.name).join(', ') : 'ERROR');
                db.all('PRAGMA table_info(taxes)', (err, rows) => {
                    console.log('taxes 컬럼:', rows ? rows.map(r => r.name).join(', ') : 'ERROR');
                    db.close(() => {
                        console.log('\n완료!');
                    });
                });
            });
        }, 500);
    });
});


















