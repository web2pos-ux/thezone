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
          mg.group_id as id,
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
        query += ' AND mg.menu_id = ?';
        params.push(menu_id);
      }
      
      query += ' ORDER BY mg.name';
      
      const groups = await dbAll(query, params);
      
      // 디버깅 로그 추가
      console.log('🔍 GET /modifier-groups - 쿼리:', query);
      console.log('🔍 GET /modifier-groups - 파라미터:', params);
      console.log('🔍 GET /modifier-groups - 결과 개수:', groups.length);
      if (groups.length > 0) {
        console.log('🔍 첫 번째 그룹의 Min/Max:', {
          name: groups[0].name,
          min_selections: groups[0].min_selections,
          max_selections: groups[0].max_selections,
          selection_type: groups[0].selection_type
        });
      }
      
      if (groups.length === 0) {
        return res.json([]);
      }

      // 각 그룹의 옵션(modifiers) 로드
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
           group_id,
           label_id,
           label_name
         FROM modifier_labels
         WHERE group_id IN (${placeholders})`,
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
      console.error('Error fetching modifier groups:', error);
      res.status(500).json({ error: 'Failed to fetch modifier groups' });
    }
  });

  // POST /api/modifier-groups - Create a new modifier group
  router.post('/', async (req, res) => {
    const { name, min_selections, max_selections, modifiers, label, menu_id } = req.body;

    // 디버깅 로그 추가
    console.log('🔍 POST /modifier-groups - 받은 데이터:', req.body);
    console.log('🔍 Min/Max 값:', { min_selections, max_selections });
    console.log('🔍 Min/Max 타입:', { 
      min_type: typeof min_selections, 
      max_type: typeof max_selections 
    });
    console.log('🔍 Min/Max 원본값:', { 
      min_original: min_selections, 
      max_original: max_selections 
    });

    // Validation
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
      if (typeof modifier.price_adjustment !== 'number') {
        return res.status(400).json({ error: 'Each modifier in the array must have a valid name and price_adjustment.' });
      }
      // 가격 조정 범위 검증 (-99999 ~ 99999)
      if (modifier.price_adjustment < -99999 || modifier.price_adjustment > 99999) {
        return res.status(400).json({ error: 'Price adjustment must be between -99999 and 99999.' });
      }
      if (modifier.price_adjustment_2 !== undefined) {
        if (typeof modifier.price_adjustment_2 !== 'number' || modifier.price_adjustment_2 < -99999 || modifier.price_adjustment_2 > 99999) {
          return res.status(400).json({ error: 'Price adjustment 2 must be a number between -99999 and 99999.' });
        }
      }
    }

    await dbRun('BEGIN TRANSACTION');

    try {
      // Create the new modifier group with dynamic selection_type based on min/max
      const newGroupId = await generateNextId(db, ID_RANGES.MODIFIER_GROUP);
      const defaultMinSelections = min_selections !== undefined ? min_selections : 0;
      const defaultMaxSelections = max_selections !== undefined ? max_selections : 0;
      
      // Determine selection_type based on min/max values
      let selectionType = 'MULTIPLE';
      if (defaultMinSelections === 1 && defaultMaxSelections === 1) {
        selectionType = 'SINGLE';
      } else if (defaultMinSelections > 0) {
        selectionType = 'REQUIRED';
      } else if (defaultMinSelections === 0 && defaultMaxSelections === 0) {
        selectionType = 'OPTIONAL';
      }
      
      console.log('🔍 저장할 Min/Max 값:', { 
        min_selections: defaultMinSelections, 
        max_selections: defaultMaxSelections,
        selection_type: selectionType
      });
      
      await dbRun('INSERT INTO modifier_groups (group_id, name, selection_type, min_selection, max_selection, menu_id, is_deleted) VALUES (?, ?, ?, ?, ?, ?, 0)', 
        [newGroupId, name, selectionType, defaultMinSelections, defaultMaxSelections, menu_id || 200000]);

      // Create individual modifier options
      const optionIds = [];
      for (let i = 0; i < modifiers.length; i++) {
        const modifier = modifiers[i];
        const newOptionId = await generateNextId(db, ID_RANGES.MODIFIER);
        const priceAdjustment2 = modifier.price_adjustment_2 || 0;
        await dbRun('INSERT INTO modifiers (modifier_id, name, price_delta, price_delta2, type, sort_order, is_deleted) VALUES (?, ?, ?, ?, ?, ?, 0)', 
          [newOptionId, modifier.name, modifier.price_adjustment, priceAdjustment2, 'OPTION', i + 1]);
        
        // Create link to group
        await dbRun('INSERT INTO modifier_group_links (modifier_group_id, modifier_id) VALUES (?, ?)', 
          [newGroupId, newOptionId]);
        
        optionIds.push(newOptionId);
      }

      // Create label if provided
      let labelId = null;
      if (label && label.trim()) {
        labelId = await generateNextId(db, ID_RANGES.MODIFIER_LABEL);
        await dbRun('INSERT INTO modifier_labels (label_id, group_id, label_name) VALUES (?, ?, ?)', 
          [labelId, newGroupId, label.trim()]);
      }

      await dbRun('COMMIT');

      // Return the newly created group, structured like the GET response
      const newGroup = {
        id: newGroupId,
        name: name,
        selection_type: selectionType,
        min_selections: defaultMinSelections,
        max_selections: defaultMaxSelections,
        modifiers: modifiers.map((modifier, index) => ({
          option_id: optionIds[index],
          name: modifier.name,
          price_adjustment: modifier.price_adjustment,
          price_adjustment_2: modifier.price_adjustment_2 || 0,
        })),
        labels: label && label.trim() ? [{ label_id: labelId, name: label.trim() }] : []
      };

      res.status(201).json(newGroup);
    } catch (error) {
      await dbRun('ROLLBACK');
      console.error('Error creating modifier group:', error);
      console.error('Request body:', req.body);
      res.status(500).json({ error: 'Failed to create modifier group', details: error.message });
    }
  });

  // POST /api/modifier-groups/:id/copy - Copy a modifier group
  router.post('/:id/copy', async (req, res) => {
    const groupId = req.params.id;
    const { name, menu_id } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'A valid name for the copied group is required.' });
    }

    try {
      await dbRun('BEGIN TRANSACTION');

      // Get original group
      const originalGroup = await dbGet('SELECT * FROM modifier_groups WHERE group_id = ?', [groupId]);
      if (!originalGroup) {
        await dbRun('ROLLBACK');
        return res.status(404).json({ error: 'Modifier group not found.' });
      }

      // Create new group
      const newGroupId = await generateNextId(db, ID_RANGES.MODIFIER_GROUP);
      await dbRun('INSERT INTO modifier_groups (group_id, name, selection_type, min_selection, max_selection, menu_id, is_deleted) VALUES (?, ?, ?, ?, ?, ?, 0)', 
        [newGroupId, name.trim(), originalGroup.selection_type, originalGroup.min_selection, originalGroup.max_selection, menu_id || 200000]);

      // Get original options through links
      const originalOptions = await dbAll(`
        SELECT m.modifier_id, m.name, m.price_delta, m.sort_order
        FROM modifiers m
        JOIN modifier_group_links mgl ON m.modifier_id = mgl.modifier_id
        WHERE mgl.modifier_group_id = ? AND m.is_deleted = 0
        ORDER BY m.sort_order, m.name
      `, [groupId]);
      
      // Copy options
      const optionIds = [];
      for (const option of originalOptions) {
        const newOptionId = await generateNextId(db, ID_RANGES.MODIFIER);
        await dbRun('INSERT INTO modifiers (modifier_id, name, price_delta, type, sort_order, is_deleted) VALUES (?, ?, ?, ?, ?, 0)', 
          [newOptionId, option.name, option.price_delta, 'OPTION', option.sort_order]);
        
        // Create link to new group
        await dbRun('INSERT INTO modifier_group_links (modifier_group_id, modifier_id) VALUES (?, ?)', 
          [newGroupId, newOptionId]);
        
        optionIds.push(newOptionId);
      }

      // Get original labels
      const originalLabels = await dbAll('SELECT * FROM modifier_labels WHERE group_id = ?', [groupId]);
      
      // Copy labels
      const labelIds = [];
      for (const label of originalLabels) {
        const newLabelId = await generateNextId(db, ID_RANGES.MODIFIER_LABEL);
        await dbRun('INSERT INTO modifier_labels (label_id, group_id, label_name) VALUES (?, ?, ?)', 
          [newLabelId, newGroupId, label.label_name]);
        labelIds.push(newLabelId);
      }

      await dbRun('COMMIT');

      // Return the copied group data
      const copiedGroup = {
        id: newGroupId,
        name: name.trim(),
        selection_type: originalGroup.selection_type,
        min_selections: originalGroup.min_selection,
        max_selections: originalGroup.max_selection,
        modifiers: originalOptions.map((option, index) => ({
          option_id: optionIds[index],
          name: option.name,
          price_adjustment: option.price_delta,
          sort_order: option.sort_order
        })),
        labels: originalLabels.map((label, index) => ({
          label_id: labelIds[index],
          name: label.label_name
        }))
      };

      res.status(201).json(copiedGroup);

    } catch (error) {
      await dbRun('ROLLBACK');
      console.error('Failed to copy modifier group:', error);
      res.status(500).json({ error: 'Failed to copy modifier group', details: error.message });
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

    // Validate each modifier
    for (const modifier of modifiers) {
      if (!modifier.name || typeof modifier.name !== 'string' || !modifier.name.trim()) {
        return res.status(400).json({ error: 'Each modifier must have a valid name.' });
      }
      if (typeof modifier.price_adjustment !== 'number') {
        return res.status(400).json({ error: 'Each modifier must have a valid price_adjustment.' });
      }
      // 가격 조정 범위 검증 (-99999 ~ 99999)
      if (modifier.price_adjustment < -99999 || modifier.price_adjustment > 99999) {
        return res.status(400).json({ error: 'Price adjustment must be between -99999 and 99999.' });
      }
      if (modifier.price_adjustment_2 !== undefined) {
        if (typeof modifier.price_adjustment_2 !== 'number' || modifier.price_adjustment_2 < -99999 || modifier.price_adjustment_2 > 99999) {
          return res.status(400).json({ error: 'Price adjustment 2 must be a number between -99999 and 99999.' });
        }
      }
    }

    await dbRun('BEGIN TRANSACTION');

    try {
      // Update group info with dynamic selection_type based on min/max
      const defaultMinSelections = min_selections !== undefined ? min_selections : 0;
      const defaultMaxSelections = max_selections !== undefined ? max_selections : 0;
      
      // Determine selection_type based on min/max values
      let selectionType = 'MULTIPLE';
      if (defaultMinSelections === 1 && defaultMaxSelections === 1) {
        selectionType = 'SINGLE';
      } else if (defaultMinSelections > 0) {
        selectionType = 'REQUIRED';
      } else if (defaultMinSelections === 0 && defaultMaxSelections === 0) {
        selectionType = 'OPTIONAL';
      }
      
      console.log('🔍 PUT - 저장할 Min/Max 값:', { 
        min_selections: defaultMinSelections, 
        max_selections: defaultMaxSelections,
        selection_type: selectionType
      });
      
      await dbRun('UPDATE modifier_groups SET name = ?, selection_type = ?, min_selection = ?, max_selection = ? WHERE group_id = ?', 
        [name, selectionType, defaultMinSelections, defaultMaxSelections, groupId]);

      // Remove old options and labels
      await dbRun('DELETE FROM modifier_group_links WHERE modifier_group_id = ?', [groupId]);
      await dbRun('DELETE FROM modifier_labels WHERE group_id = ?', [groupId]);

      // Create new options
      const optionIds = [];
      for (let i = 0; i < modifiers.length; i++) {
        const modifier = modifiers[i];
        const newOptionId = await generateNextId(db, ID_RANGES.MODIFIER);
        const priceAdjustment2 = modifier.price_adjustment_2 || 0;
        await dbRun('INSERT INTO modifiers (modifier_id, name, price_delta, price_delta2, type, sort_order, is_deleted) VALUES (?, ?, ?, ?, ?, ?, 0)', 
          [newOptionId, modifier.name, modifier.price_adjustment, priceAdjustment2, 'OPTION', i + 1]);
        
        // Create link to group
        await dbRun('INSERT INTO modifier_group_links (modifier_group_id, modifier_id) VALUES (?, ?)', 
          [groupId, newOptionId]);
        
        optionIds.push(newOptionId);
      }

      // Create new label if provided
      let labelId = null;
      if (label && label.trim()) {
        labelId = await generateNextId(db, ID_RANGES.MODIFIER_LABEL);
        await dbRun('INSERT INTO modifier_labels (label_id, group_id, label_name) VALUES (?, ?, ?)', 
          [labelId, groupId, label.trim()]);
      }

      await dbRun('COMMIT');

      const updatedGroup = {
        id: parseInt(groupId),
        name: name,
        selection_type: selectionType,
        min_selections: defaultMinSelections,
        max_selections: defaultMaxSelections,
        modifiers: modifiers.map((modifier, index) => ({
          option_id: optionIds[index],
          name: modifier.name,
          price_adjustment: modifier.price_adjustment,
          price_adjustment_2: modifier.price_adjustment_2 || 0,
        })),
        labels: label && label.trim() ? [{ label_id: labelId, name: label.trim() }] : []
      };

      res.json(updatedGroup);
    } catch (error) {
      await dbRun('ROLLBACK');
      console.error('Error updating modifier group:', error);
      res.status(500).json({ error: 'Failed to update modifier group' });
    }
  });

  // PATCH /api/modifier-groups/:id/settings - Update only min/max selections
  router.patch('/:id/settings', async (req, res) => {
    const groupId = req.params.id;
    const { min_selections, max_selections } = req.body;

    // Validation
    if (min_selections === undefined || max_selections === undefined) {
      return res.status(400).json({ error: 'min_selections and max_selections are required.' });
    }

    if (typeof min_selections !== 'number' || typeof max_selections !== 'number') {
      return res.status(400).json({ error: 'min_selections and max_selections must be numbers.' });
    }

    if (min_selections < 0 || max_selections < 0) {
      return res.status(400).json({ error: 'min_selections and max_selections must be non-negative.' });
    }

    if (min_selections > max_selections) {
      return res.status(400).json({ error: 'min_selections cannot be greater than max_selections.' });
    }

    try {
      // Determine selection_type based on min/max values
      let selectionType = 'MULTIPLE';
      if (min_selections === 1 && max_selections === 1) {
        selectionType = 'SINGLE';
      } else if (min_selections > 0) {
        selectionType = 'REQUIRED';
      }

      // Update the modifier group
      await dbRun('UPDATE modifier_groups SET selection_type = ?, min_selection = ?, max_selection = ? WHERE group_id = ?', 
        [selectionType, min_selections, max_selections, groupId]);

      // Get updated group info
      const updatedGroup = await dbGet('SELECT * FROM modifier_groups WHERE group_id = ?', [groupId]);
      
      if (!updatedGroup) {
        return res.status(404).json({ error: 'Modifier group not found.' });
      }

      res.json({
        id: parseInt(groupId),
        name: updatedGroup.name,
        selection_type: selectionType,
        min_selections: min_selections,
        max_selections: max_selections,
        message: 'Settings updated successfully'
      });

    } catch (error) {
      console.error('Error updating modifier group settings:', error);
      res.status(500).json({ error: 'Failed to update modifier group settings' });
    }
  });

  // DELETE /api/modifier-groups/:groupId - Delete a modifier group
  router.delete('/:groupId', async (req, res) => {
    const { groupId } = req.params;
    console.log('🗑️ DELETE request for modifier group:', groupId);

    await dbRun('BEGIN TRANSACTION');
    try {
      console.log('🗑️ Removing modifier group links...');
      // Remove links to modifiers (modifiers remain as they can be reused)
      await dbRun('DELETE FROM modifier_group_links WHERE modifier_group_id = ?', [groupId]);
      
      console.log('🗑️ Removing modifier labels...');
      // Delete modifier labels
      await dbRun('DELETE FROM modifier_labels WHERE group_id = ?', [groupId]);
      
      console.log('🗑️ Removing menu item links...');
      // Delete menu item links that reference this modifier group
      await dbRun('DELETE FROM menu_modifier_links WHERE modifier_group_id = ?', [groupId]);
      
      console.log('🗑️ Removing category links...');
      // Delete category links that reference this modifier group
      await dbRun('DELETE FROM category_modifier_links WHERE modifier_group_id = ?', [groupId]);
      
      console.log('🗑️ Soft deleting modifier group...');
      // Soft delete the modifier group
      await dbRun('UPDATE modifier_groups SET is_deleted = 1 WHERE group_id = ?', [groupId]);

      await dbRun('COMMIT');
      console.log('✅ Modifier group deleted successfully');
      res.status(204).send();
    } catch (error) {
      await dbRun('ROLLBACK');
      console.error(`❌ Failed to delete modifier group ${groupId}:`, error);
      res.status(500).json({ error: 'Failed to delete modifier group', details: error.message });
    }
  });

  return router;
}; 