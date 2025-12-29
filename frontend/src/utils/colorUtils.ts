export const getComplementaryNormalColor = (selectedColor: string): string => {
  const match = selectedColor.match(/bg-(\w+)-(\d{2,3})$/);
  if (!match) return 'bg-gray-200';
  const [, colorName, shade] = match;
  const currentShade = parseInt(shade, 10);
  if (currentShade >= 600 && currentShade <= 950) {
    return `bg-${colorName}-200`;
  }
  const colorMap: { [key: string]: string } = {
    'bg-blue-500': 'bg-blue-200',
    'bg-green-500': 'bg-green-200',
    'bg-yellow-500': 'bg-yellow-200',
    'bg-red-500': 'bg-red-200',
    'bg-purple-500': 'bg-purple-200',
    'bg-indigo-500': 'bg-indigo-200',
    'bg-pink-500': 'bg-pink-200',
    'bg-orange-500': 'bg-orange-200',
    'bg-teal-500': 'bg-teal-200',
    'bg-emerald-500': 'bg-emerald-200',
    'bg-cyan-500': 'bg-cyan-200',
    'bg-rose-500': 'bg-rose-200',
    'bg-violet-500': 'bg-violet-200',
    'bg-fuchsia-500': 'bg-fuchsia-200',
    'bg-sky-500': 'bg-sky-200',
    'bg-lime-500': 'bg-lime-200'
  };
  return colorMap[selectedColor] || 'bg-gray-200';
};

export const isHexColor = (color: string): boolean => {
  return /^#[0-9A-F]{6}$/i.test(color);
};

export const getDarkerHexColor = (hex: string): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const factor = 0.85;
  const newR = Math.floor(r * factor);
  const newG = Math.floor(g * factor);
  const newB = Math.floor(b * factor);
  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
};

export const getSelectedButtonColor = (baseColor: string): string => {
  const match = baseColor.match(/bg-(\w+)-(\d{2,3})$/);
  if (!match) return baseColor;
  const [, colorName, shade] = match;
  const currentShade = parseInt(shade, 10);
  let darkerShade = Math.min(currentShade + 200, 900);
  darkerShade = Math.round(darkerShade / 100) * 100;
  darkerShade = Math.max(darkerShade, 600);
  return `bg-${colorName}-${darkerShade}`;
};

export const getHexLuminance = (hex: string): number => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

export const getContrastingTextColor = (bgClass: string): 'text-white' | 'text-black' => {
  if (isHexColor(bgClass)) {
    const luminance = getHexLuminance(bgClass);
    return luminance > 0.5 ? 'text-black' : 'text-white';
  }
  const match = bgClass.match(/bg-\w+-(\d{2,3})$/);
  if (!match) return 'text-black';
  const shade = parseInt(match[1], 10);
  if (shade <= 300) return 'text-black';
  if (shade >= 400) return 'text-white';
  return 'text-black';
};

export const getSelectedItemColor = (baseColor: string): string => {
  const match = baseColor.match(/bg-(\w+)-(\d{2,3})$/);
  if (!match) return baseColor;
  const [, colorName, shade] = match;
  const currentShade = parseInt(shade, 10);
  let darkerShade = Math.min(currentShade + 200, 900);
  darkerShade = Math.round(darkerShade / 100) * 100;
  darkerShade = Math.max(darkerShade, 600);
  return `bg-${colorName}-${darkerShade}`;
}; 