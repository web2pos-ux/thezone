import React from 'react';
import { X } from 'lucide-react';

interface InvalidLinkBadgeProps {
  name: string;
  type: 'modifier' | 'tax' | 'printer';
}

const InvalidLinkBadge: React.FC<InvalidLinkBadgeProps> = ({ name, type }) => {
  const getTypeColor = () => {
    switch (type) {
      case 'modifier':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'tax':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'printer':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getTypeIcon = () => {
    switch (type) {
      case 'modifier':
        return '⚙️';
      case 'tax':
        return '💰';
      case 'printer':
        return '🖨️';
      default:
        return '❓';
    }
  };

  return (
    <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-xs font-medium ${getTypeColor()}`}>
      <span>{getTypeIcon()}</span>
      <span className="truncate max-w-20">{name}</span>
      <X size={12} className="text-red-600 flex-shrink-0" />
    </div>
  );
};

export default InvalidLinkBadge; 