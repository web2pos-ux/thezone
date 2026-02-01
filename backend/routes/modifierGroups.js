const express = require('express');
const router = express.Router();
const { generateNextId, ID_RANGES } = require('../utils/idGenerator');

module.exports = (db) => {
  // Promise-based wrappers for db methods
  const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

  // GET /api/modifier-groups - Get all modifier groups
  router.get('/', async (req, res) => {
    try {
      const { menu_id } = req.query;
      let query = `
        SELECT 
          mg.modifier_group_id as id,
          mg.name,
          mg.selection_type,
          mg.min_selection as min_selections,
          mg.max_selection as max_selections,
          mg.menu_id
        FROM modifier_groups mg
        WHERE mg.is_deleted = 0
      `;
      
      const params = [];
      if (menu_id) {
        query += ' AND (mg.menu_id = ? OR mg.menu_id IS NULL)';
        params.push(menu_id);
      }
      
      query += ' ORDER BY mg.name';
      const groups = await dbAll(query, params);
      
      if (groups.length === 0) {
        return res.json([]);
      }

      const groupIds = groups.map(g => g.id);
      const placeholders = groupIds.map(() => '?').join(',');

      const options = await dbAll(
        `SELECT 
           mgl.modifier_group_id as group_id,
           m.modifier_id as option_id,
           m.name,
           m.price_delta as price_adjustment,
           m.price_delta2 as price_adjustment_2,
           m.sort_order
         FROM modifier_group_links mgl
         JOIN modifiers m ON m.modifier_id = mgl.modifier_id
         WHERE mgl.modifier_group_id IN (${placeholders}) AND m.is_deleted = 0
         ORDER BY mgl.modifier_group_id, m.sort_order, m.name`,
        groupIds
      );

      const labels = await dbAll(
        `SELECT 
           modifier_group_id as group_id,
           label_id,
           label_name
         FROM modifier_labels
         WHERE modifier_group_id IN (${placeholders})`,
        groupIds
      );

      const optionsByGroupId = options.reduce((acc, row) => {
        if (!acc[row.group_id]) acc[row.group_id] = [];
        acc[row.group_id].push({
          option_id: row.option_id,
          name: row.name,
          price_adjustment: row.price_adjustment,
          price_adjustment_2: row.price_adjustment_2 || 0,
          sort_order: row.sort_order
        });
        return acc;
      }, {});

      const labelsByGroupId = labels.reduce((acc, row) => {
        if (!acc[row.group_id]) acc[row.group_id] = [];
        acc[row.group_id].push({ label_id: row.label_id, name: row.label_name });
        return acc;
      }, {});

      const enriched = groups.map(g => ({
        ...g,
        modifiers: optionsByGroupId[g.id] || [],
        labels: labelsByGroupId[g.id] || []
      }));
      
      res.json(enriched);
    } catch (error) {
      console.error('❌ Failed to fetch modifier groups:', error);
      res.status(500).json({ error: 'Failed to fetch modifier groups.' });
    }
  });

  // POST /api/modifier-groups - Create a new modifier group
  router.post('/', async (req, res) => {
    const { name, min_selections, max_selections, modifiers, label, menu_id } = req.body;

    console.log('🔍 POST /modifier-groups - Received data:', { name, min_selections, max_selections, modifiersCount: modifiers?.length, label, menu_id });

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'A valid name is required.' });
    }

    if (!Array.isArray(modifiers) || modifiers.length === 0) {
      return res.status(400).json({ error: 'At least one modifier is required.' });
    }

    // Validate each modifier
    for (const modifier of modifiers) {
      if (!modifier.name || typeof modifier.name !== 'string' || !modifier.name.trim()) {
        return res.status(400).json({ error: 'Each modifier must have a valid name.' });
      }
    }

    try {
      console.log('🔄 Starting transaction for modifier group creation...');
      await dbRun('BEGIN TRANSACTION');
      
      const defaultMin = min_selections !== undefined ? parseInt(min_selections, 10) : 0;
      const defaultMax = max_selections !== undefined ? parseInt(max_selections, 10) : 1;
      
      let selectionType = 'MULTIPLE';
      if (defaultMin === 1 && defaultMax === 1) selectionType = 'SINGLE';
      else if (defaultMin > 0) selectionType = 'REQUIRED';
      else if (defaultMin === 0 && defaultMax === 0) selectionType = 'OPTIONAL';
      
      // 1. Create Modifier Group
      const newGroupId = await generateNextId(db, ID_RANGES.MODIFIER_GROUP);
      await dbRun(`INSERT INTO modifier_groups 
        (modifier_group_id, name, selection_type, min_selection, max_selection, menu_id, is_deleted) 
        VALUES (?, ?, ?, ?, ?, ?, 0)`, 
        [newGroupId, name.trim(), selectionType, defaultMin, defaultMax, menu_id || 200000]);

      // 2. Create individual modifiers and links
      const optionIds = [];
      for (let i = 0; i < modifiers.length; i++) {
        const mod = modifiers[i];
        const newModId = await generateNextId(db, ID_RANGES.MODIFIER);
        
        await dbRun(`INSERT INTO modifiers 
          (modifier_id, name, price_delta, price_delta2, type, sort_order, is_deleted) 
          VALUES (?, ?, ?, ?, 'OPTION', ?, 0)`, 
          [newModId, mod.name.trim(), mod.price_adjustment || 0, mod.price_adjustment_2 || 0, i + 1]);
        
        await dbRun(`INSERT INTO modifier_group_links (modifier_group_id, modifier_id) VALUES (?, ?)`, 
          [newGroupId, newModId]);
        
        optionIds.push(newModId);
      }

      // 3. Create label if provided
      let labelId = null;
      if (label && label.trim()) {
        labelId = await generateNextId(db, ID_RANGES.MODIFIER_LABEL);
        await dbRun(`INSERT INTO modifier_labels (label_id, modifier_group_id, label_name) VALUES (?, ?, ?)`, 
          [labelId, newGroupId, label.trim()]);
      }

      await dbRun('COMMIT');
      console.log('✅ Modifier group creation completed successfully:', newGroupId);

      res.status(201).json({
        id: newGroupId,
        name: name.trim(),
        selection_type: selectionType,
        min_selections: defaultMin,
        max_selections: defaultMax,
        modifiers: modifiers.map((m, i) => ({ 
          option_id: optionIds[i], 
          name: m.name.trim(),
          price_adjustment: m.price_adjustment || 0,
          price_adjustment_2: m.price_adjustment_2 || 0
        })),
        labels: label && label.trim() ? [{ label_id: labelId, name: label.trim() }] : []
      });
    } catch (error) {
      await dbRun('ROLLBACK').catch(() => {});
      console.error('❌ Error creating modifier group:', error);
      res.status(500).json({ error: 'Failed to create modifier group.', details: error.message });
    }
  });

  // PUT /api/modifier-groups/:id - Update a modifier group
  router.put('/:id', async (req, res) => {
    const groupId = req.params.id;
    const { name, min_selections, max_selections, modifiers, label } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'A valid name is required.' });
    }

    if (!Array.isArray(modifiers) || modifiers.length === 0) {
      return res.status(400).json({ error: 'At least one modifier is required.' });
    }

    try {
      await dbRun('BEGIN TRANSACTION');

      const defaultMin = min_selections !== undefined ? parseInt(min_selections, 10) : 0;
      const defaultMax = max_selections !== undefined ? parseInt(max_selections, 10) : 1;
      
      let selectionType = 'MULTIPLE';
      if (defaultMin === 1 && defaultMax === 1) selectionType = 'SINGLE';
      else if (defaultMin > 0) selectionType = 'REQUIRED';
      else if (defaultMin === 0 && defaultMax === 0) selectionType = 'OPTIONAL';
      
      await dbRun('UPDATE modifier_groups SET name = ?, selection_type = ?, min_selection = ?, max_selection = ?, is_deleted = 0 WHERE modifier_group_id = ?', 
        [name.trim(), selectionType, defaultMin, defaultMax, groupId]);

      // Soft delete existing modifiers in this group before adding new ones
      await dbRun(`
        UPDATE modifiers SET is_deleted = 1 
        WHERE modifier_id IN (SELECT modifier_id FROM modifier_group_links WHERE modifier_group_id = ?)
      `, [groupId]);

      await dbRun('DELETE FROM modifier_group_links WHERE modifier_group_id = ?', [groupId]);
      await dbRun('DELETE FROM modifier_labels WHERE modifier_group_id = ?', [groupId]);

      const optionIds = [];
      for (let i = 0; i < modifiers.length; i++) {
        const mod = modifiers[i];
        const newModId = await generateNextId(db, ID_RANGES.MODIFIER);
        const price2 = mod.price_adjustment_2 || 0;
        
        await dbRun('INSERT INTO modifiers (modifier_id, name, price_delta, price_delta2, type, sort_order, is_deleted) VALUES (?, ?, ?, ?, ?, ?, 0)', 
          [newModId, mod.name.trim(), mod.price_adjustment || 0, price2, 'OPTION', i + 1]);
        
        await dbRun('INSERT INTO modifier_group_links (modifier_group_id, modifier_id) VALUES (?, ?)', 
          [groupId, newModId]);
        
        optionIds.push(newModId);
      }

      let labelId = null;
      if (label && label.trim()) {
        labelId = await generateNextId(db, ID_RANGES.MODIFIER_LABEL);
        await dbRun('INSERT INTO modifier_labels (label_id, modifier_group_id, label_name) VALUES (?, ?, ?)', 
          [labelId, groupId, label.trim()]);
      }

      await dbRun('COMMIT');
      res.json({
        id: parseInt(groupId),
        name: name.trim(),
        selection_type: selectionType,
        min_selections: defaultMin,
        max_selections: defaultMax,
        modifiers: modifiers.map((m, index) => ({
          option_id: optionIds[index],
          name: m.name.trim(),
          price_adjustment: m.price_adjustment || 0,
          price_adjustment_2: m.price_adjustment_2 || 0,
        })),
        labels: label && label.trim() ? [{ label_id: labelId, name: label.trim() }] : []
      });
    } catch (error) {
      await dbRun('ROLLBACK').catch(() => {});
      console.error('❌ Failed to update modifier group:', error);
      res.status(500).json({ error: 'Failed to update modifier group.' });
    }
  });

  // DELETE /api/modifier-groups/:groupId - Delete a modifier group
  router.delete('/:groupId', async (req, res) => {
    const { groupId } = req.params;
    try {
      await dbRun('BEGIN TRANSACTION');
      await dbRun('UPDATE modifier_groups SET is_deleted = 1 WHERE modifier_group_id = ?', [groupId]);
      // Links remain but marked as deleted or simply not selected in queries
      await dbRun('DELETE FROM modifier_group_links WHERE modifier_group_id = ?', [groupId]);
      await dbRun('DELETE FROM modifier_labels WHERE modifier_group_id = ?', [groupId]);
      await dbRun('DELETE FROM menu_modifier_links WHERE modifier_group_id = ?', [groupId]);
      await dbRun('DELETE FROM category_modifier_links WHERE modifier_group_id = ?', [groupId]);

      await dbRun('COMMIT');
      res.status(204).send();
    } catch (error) {
      await dbRun('ROLLBACK').catch(() => {});
      console.error('❌ Failed to delete modifier group:', error);
      res.status(500).json({ error: 'Failed to delete modifier group.', details: error.message });
    }
  });

  return router;
};
