import React, { useRef } from 'react';
import { ImagePlus } from 'lucide-react';

interface ImageUploaderProps {
  imageUrl: string | undefined;
  onUpload: (file: File) => void;
}

const ImageUploader: React.FC<ImageUploaderProps> = ({ imageUrl, onUpload }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onUpload(file);
    }
  };

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImageUpload}
        className="hidden"
        accept="image/*"
      />
      <button 
        onClick={() => fileInputRef.current?.click()}
        className="w-10 h-10 bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors"
      >
        {imageUrl ? (
          <img src={`http://localhost:3177${imageUrl}`} alt="Menu item" className="w-full h-full object-cover" />
        ) : (
          <ImagePlus className="text-slate-400" />
        )}
      </button>
    </>
  );
};

export default ImageUploader; 