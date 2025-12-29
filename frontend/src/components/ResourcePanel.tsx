import React, { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Resource, ResourceType } from '../types';

type DraggableResourceProps = {
  resource: Resource;
  type: ResourceType;
};

const DraggableResource = ({ resource, type }: DraggableResourceProps) => {
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: `${type}-${resource.id}`,
    data: { resource, type },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="p-2 border rounded-md bg-white cursor-grab hover:bg-gray-100"
    >
      {resource.name}
    </div>
  );
};

type ResourcePanelProps = {
  modifiers: Resource[];
  taxes: Resource[];
  printers: Resource[];
};

const ResourcePanel = ({ modifiers, taxes, printers }: ResourcePanelProps) => {
  const [activeTab, setActiveTab] = useState<ResourceType>('modifier');

  const tabs: { type: ResourceType, label: string, data: Resource[] }[] = [
    { type: 'modifier', label: '모디파이어', data: modifiers },
    { type: 'tax', label: '세금', data: taxes },
    { type: 'printer', label: '프린터', data: printers },
  ];

  return (
    <aside className="h-full bg-white rounded-lg shadow-sm flex flex-col overflow-hidden">
        <h2 className="text-lg font-semibold p-4 shrink-0 text-slate-800 bg-slate-50">Menu Options</h2>
        
        <div className="p-2 bg-slate-100 shrink-0">
          <div className="flex bg-slate-200 rounded-md p-1">
            {tabs.map(tab => (
              <button
                key={tab.type}
                onClick={() => setActiveTab(tab.type)}
                className={`w-full text-center px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                  activeTab === tab.type
                    ? 'bg-white text-blue-700 shadow'
                    : 'text-slate-600 hover:bg-slate-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 p-2">
            {tabs.find(tab => tab.type === activeTab)?.data.map(resource => (
            <DraggableResource key={resource.id} resource={resource} type={activeTab} />
            ))}
        </div>
    </aside>
  );
};

export default ResourcePanel; 