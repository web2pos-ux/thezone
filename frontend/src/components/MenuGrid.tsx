import React from 'react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableItem } from './SortableItem';
import { MenuItem } from '../types';

type MenuItemListProps = {
  items: MenuItem[];
};

const MenuItemList = ({ items }: MenuItemListProps) => {
  if (items.length === 0) {
    return (
        <main className="w-full h-full bg-white p-4 flex justify-center items-center">
            <p className="text-gray-500">No menu items in selected category.</p>
        </main>
    )
  }

  return (
    <main className="w-full h-full bg-white p-4 overflow-y-auto">
      <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2">
          {items.map((item) => (
            <SortableItem key={item.id} id={item.id}>
              <li className="flex justify-between items-center p-4 border rounded-lg bg-gray-50 cursor-grab">
                <span className="font-semibold">{item.name}</span>
                <span className="text-gray-600">${item.price.toLocaleString()}</span>
              </li>
            </SortableItem>
          ))}
        </ul>
      </SortableContext>
    </main>
  );
};

export default MenuItemList; 