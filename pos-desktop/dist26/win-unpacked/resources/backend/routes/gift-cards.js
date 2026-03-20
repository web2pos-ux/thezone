// Gift Card Routes - 매출로 잡히지 않는 선수금 처리
const express = require('express');
const router = express.Router();

module.exports = function(db) {
  const isValidCardNumber = (value) => {
    const s = String(value || '').trim();
    return /^\d{4,16}$/.test(s);
  };

  // Helper functions
  const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

  const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

  // Create gift_cards table if not exists
  const initTable = async () => {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS gift_cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_number TEXT UNIQUE NOT NULL,
        initial_amount REAL NOT NULL,
        current_balance REAL NOT NULL,
        payment_method TEXT,
        customer_name TEXT,
        customer_phone TEXT,
        sold_by TEXT,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Gift card transactions table for tracking usage
    await dbRun(`
      CREATE TABLE IF NOT EXISTS gift_card_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_number TEXT NOT NULL,
        transaction_type TEXT NOT NULL,
        amount REAL NOT NULL,
        balance_after REAL NOT NULL,
        order_id INTEGER,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (card_number) REFERENCES gift_cards(card_number)
      )
    `);

    console.log('Gift Cards tables initialized');
  };

  initTable();

  // POST /api/gift-cards - Sell a new gift card (선수금 처리, 매출 아님)
  router.post('/', async (req, res) => {
    try {
      const { card_number, amount, payment_method, customer_name, customer_phone, sold_by, seller_pin } = req.body;

      if (!isValidCardNumber(card_number)) {
        return res.status(400).json({ message: 'Invalid card number. Must be 4-16 digits.' });
      }

      if (!amount || amount <= 0) {
        return res.status(400).json({ message: 'Invalid amount.' });
      }

      // Check if card already exists - now returns info for reload
      const existing = await dbGet('SELECT * FROM gift_cards WHERE card_number = ?', [card_number]);
      if (existing) {
        return res.status(409).json({ 
          message: 'Card already exists', 
          exists: true,
          current_balance: existing.current_balance 
        });
      }

      // Insert new gift card
      const result = await dbRun(`
        INSERT INTO gift_cards (card_number, initial_amount, current_balance, payment_method, customer_name, customer_phone, sold_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `, [card_number, amount, amount, payment_method, customer_name, customer_phone, sold_by]);

      // Record transaction
      await dbRun(`
        INSERT INTO gift_card_transactions (card_number, transaction_type, amount, balance_after, notes, created_at)
        VALUES (?, 'sale', ?, ?, ?, datetime('now'))
      `, [card_number, amount, amount, `Sold by ${sold_by || 'Staff'} (PIN: ${seller_pin || 'N/A'})`]);

      res.status(201).json({
        success: true,
        message: 'Gift card sold successfully',
        card: {
          id: result.lastID,
          card_number,
          balance: amount
        }
      });
    } catch (error) {
      console.error('Error selling gift card:', error);
      res.status(500).json({ message: 'Failed to sell gift card', error: error.message });
    }
  });

  // POST /api/gift-cards/:cardNumber/reload - Reload an existing gift card
  router.post('/:cardNumber/reload', async (req, res) => {
    try {
      const { cardNumber } = req.params;
      const { amount, payment_method, sold_by, seller_pin } = req.body;

      if (!isValidCardNumber(cardNumber)) {
        return res.status(400).json({ message: 'Invalid card number. Must be 4-16 digits.' });
      }

      if (!amount || amount <= 0) {
        return res.status(400).json({ message: 'Invalid amount.' });
      }

      const card = await dbGet('SELECT * FROM gift_cards WHERE card_number = ?', [cardNumber]);

      if (!card) {
        return res.status(404).json({ message: 'Card not found' });
      }

      const newBalance = card.current_balance + amount;

      // Update balance
      await dbRun(`
        UPDATE gift_cards SET current_balance = ?, updated_at = datetime('now')
        WHERE card_number = ?
      `, [newBalance, cardNumber]);

      // Record transaction
      await dbRun(`
        INSERT INTO gift_card_transactions (card_number, transaction_type, amount, balance_after, notes, created_at)
        VALUES (?, 'reload', ?, ?, ?, datetime('now'))
      `, [cardNumber, amount, newBalance, `Reloaded by ${sold_by || 'Staff'} (PIN: ${seller_pin || 'N/A'})`]);

      res.json({
        success: true,
        message: 'Gift card reloaded successfully',
        card_number: cardNumber,
        amount_added: amount,
        new_balance: newBalance
      });
    } catch (error) {
      console.error('Error reloading gift card:', error);
      res.status(500).json({ message: 'Failed to reload gift card', error: error.message });
    }
  });

  // GET /api/gift-cards/:cardNumber/balance - Check balance
  router.get('/:cardNumber/balance', async (req, res) => {
    try {
      const { cardNumber } = req.params;

      if (!isValidCardNumber(cardNumber)) {
        return res.status(400).json({ message: 'Invalid card number. Must be 4-16 digits.' });
      }

      const card = await dbGet('SELECT * FROM gift_cards WHERE card_number = ?', [cardNumber]);

      if (!card) {
        return res.status(404).json({ message: 'Card not found' });
      }

      res.json({
        card_number: card.card_number,
        balance: card.current_balance,
        initial_amount: card.initial_amount,
        status: card.status,
        customer_name: card.customer_name
      });
    } catch (error) {
      console.error('Error checking gift card balance:', error);
      res.status(500).json({ message: 'Failed to check balance', error: error.message });
    }
  });

  // POST /api/gift-cards/:cardNumber/redeem - Use gift card for payment
  router.post('/:cardNumber/redeem', async (req, res) => {
    try {
      const { cardNumber } = req.params;
      const { amount, order_id } = req.body;

      if (!isValidCardNumber(cardNumber)) {
        return res.status(400).json({ message: 'Invalid card number. Must be 4-16 digits.' });
      }

      if (!amount || amount <= 0) {
        return res.status(400).json({ message: 'Invalid amount' });
      }

      const card = await dbGet('SELECT * FROM gift_cards WHERE card_number = ?', [cardNumber]);

      if (!card) {
        return res.status(404).json({ message: 'Card not found' });
      }

      if (card.status !== 'active') {
        return res.status(400).json({ message: 'Card is not active' });
      }

      if (card.current_balance < amount) {
        return res.status(400).json({ message: 'Insufficient balance', balance: card.current_balance });
      }

      const newBalance = card.current_balance - amount;

      // Update balance
      await dbRun(`
        UPDATE gift_cards SET current_balance = ?, updated_at = datetime('now')
        WHERE card_number = ?
      `, [newBalance, cardNumber]);

      // Record transaction
      await dbRun(`
        INSERT INTO gift_card_transactions (card_number, transaction_type, amount, balance_after, order_id, created_at)
        VALUES (?, 'redeem', ?, ?, ?, datetime('now'))
      `, [cardNumber, -amount, newBalance, order_id]);

      res.json({
        success: true,
        message: 'Gift card redeemed successfully',
        amount_used: amount,
        new_balance: newBalance
      });
    } catch (error) {
      console.error('Error redeeming gift card:', error);
      res.status(500).json({ message: 'Failed to redeem gift card', error: error.message });
    }
  });

  // GET /api/gift-cards - List all gift cards (for reporting)
  router.get('/', async (req, res) => {
    try {
      const cards = await dbAll(`
        SELECT * FROM gift_cards ORDER BY created_at DESC
      `);

      res.json(cards);
    } catch (error) {
      console.error('Error fetching gift cards:', error);
      res.status(500).json({ message: 'Failed to fetch gift cards', error: error.message });
    }
  });

  // GET /api/gift-cards/:cardNumber/transactions - Get transaction history
  router.get('/:cardNumber/transactions', async (req, res) => {
    try {
      const { cardNumber } = req.params;

      const transactions = await dbAll(`
        SELECT * FROM gift_card_transactions 
        WHERE card_number = ? 
        ORDER BY created_at DESC
      `, [cardNumber]);

      res.json(transactions);
    } catch (error) {
      console.error('Error fetching transactions:', error);
      res.status(500).json({ message: 'Failed to fetch transactions', error: error.message });
    }
  });

  // GET /api/gift-cards/report/summary - Get gift card report summary
  router.get('/report/summary', async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      let dateFilter = '';
      const params = [];
      
      if (startDate && endDate) {
        dateFilter = 'WHERE created_at >= ? AND created_at < ?';
        params.push(startDate, endDate + ' 23:59:59');
      }

      // Summary statistics
      const summary = await dbGet(`
        SELECT 
          COUNT(*) as total_cards,
          COALESCE(SUM(initial_amount), 0) as total_sold_amount,
          COALESCE(SUM(current_balance), 0) as total_remaining_balance,
          COALESCE(SUM(initial_amount - current_balance), 0) as total_used_amount
        FROM gift_cards
        ${dateFilter}
      `, params);

      // Transaction summary
      const transactionParams = startDate && endDate ? [startDate, endDate + ' 23:59:59'] : [];
      const transactionFilter = startDate && endDate ? 'WHERE created_at >= ? AND created_at < ?' : '';
      
      const salesTotal = await dbGet(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM gift_card_transactions
        WHERE transaction_type = 'sale'
        ${startDate && endDate ? 'AND created_at >= ? AND created_at < ?' : ''}
      `, transactionParams);

      const reloadTotal = await dbGet(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM gift_card_transactions
        WHERE transaction_type = 'reload'
        ${startDate && endDate ? 'AND created_at >= ? AND created_at < ?' : ''}
      `, transactionParams);

      const redeemTotal = await dbGet(`
        SELECT COALESCE(SUM(ABS(amount)), 0) as total
        FROM gift_card_transactions
        WHERE transaction_type = 'redeem'
        ${startDate && endDate ? 'AND created_at >= ? AND created_at < ?' : ''}
      `, transactionParams);

      res.json({
        summary: {
          total_cards: summary.total_cards,
          total_sold_amount: summary.total_sold_amount,
          total_remaining_balance: summary.total_remaining_balance,
          total_used_amount: summary.total_used_amount,
          sales_total: salesTotal.total,
          reload_total: reloadTotal.total,
          redeem_total: redeemTotal.total
        }
      });
    } catch (error) {
      console.error('Error fetching gift card summary:', error);
      res.status(500).json({ message: 'Failed to fetch summary', error: error.message });
    }
  });

  // GET /api/gift-cards/report/transactions - Get all transactions for report
  router.get('/report/transactions', async (req, res) => {
    try {
      const { startDate, endDate, type } = req.query;
      
      let whereClause = '1=1';
      const params = [];
      
      if (startDate && endDate) {
        whereClause += ' AND t.created_at >= ? AND t.created_at < ?';
        params.push(startDate, endDate + ' 23:59:59');
      }
      
      if (type && type !== 'all') {
        whereClause += ' AND t.transaction_type = ?';
        params.push(type);
      }

      const transactions = await dbAll(`
        SELECT 
          t.*,
          g.customer_name,
          g.customer_phone,
          g.initial_amount,
          g.current_balance as card_current_balance
        FROM gift_card_transactions t
        LEFT JOIN gift_cards g ON t.card_number = g.card_number
        WHERE ${whereClause}
        ORDER BY t.created_at DESC
        LIMIT 500
      `, params);

      res.json(transactions);
    } catch (error) {
      console.error('Error fetching transactions report:', error);
      res.status(500).json({ message: 'Failed to fetch transactions', error: error.message });
    }
  });

  // GET /api/gift-cards/report/cards - Get all cards with details for report
  router.get('/report/cards', async (req, res) => {
    try {
      const { status, hasBalance } = req.query;
      
      let whereClause = '1=1';
      const params = [];
      
      if (status && status !== 'all') {
        whereClause += ' AND status = ?';
        params.push(status);
      }
      
      if (hasBalance === 'true') {
        whereClause += ' AND current_balance > 0';
      } else if (hasBalance === 'false') {
        whereClause += ' AND current_balance = 0';
      }

      const cards = await dbAll(`
        SELECT 
          *,
          (initial_amount - current_balance) as used_amount
        FROM gift_cards
        WHERE ${whereClause}
        ORDER BY created_at DESC
      `, params);

      res.json(cards);
    } catch (error) {
      console.error('Error fetching cards report:', error);
      res.status(500).json({ message: 'Failed to fetch cards', error: error.message });
    }
  });

  return router;
};



