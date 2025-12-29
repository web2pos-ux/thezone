import React from 'react';

interface AmbiguousLinkBadgeProps {
  name: string;
  isAmbiguous: boolean;
}

const AmbiguousLinkBadge: React.FC<AmbiguousLinkBadgeProps> = ({ name, isAmbiguous }) => {
  if (!isAmbiguous) {
    return <span className="badge bg-primary">{name}</span>;
  }

  return (
    <span 
      className="badge bg-warning text-dark" 
      title={`중복된 이름 "${name}"이 발견되어 첫 번째 그룹이 연결되었습니다.`}
    >
      {name} ⚠️
    </span>
  );
};

export default AmbiguousLinkBadge; 