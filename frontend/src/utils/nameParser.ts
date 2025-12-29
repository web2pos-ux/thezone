export type ParsedName = {
  firstName: string;
  lastName: string;
  displayName: string;
  order: 'firstLast' | 'lastFirst';
};

const HANGUL_REGEX = /[\uAC00-\uD7AF\u1100-\u11FF]/;
const CJK_REGEX = /[\u4E00-\u9FFF]/;
const HIRAGANA_REGEX = /[\u3040-\u309F]/;
const KATAKANA_REGEX = /[\u30A0-\u30FF]/;
const MONGOLIAN_REGEX = /[\u1800-\u18AF]/;
const VIETNAMESE_REGEX =
  /[ăâđêôơưĂÂĐÊÔƠƯàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵÀÁẢÃẠẰẮẲẴẶẦẤẨẪẬÈÉẺẼẸỀẾỂỄỆÒÓỎÕỌỒỐỔỖỘỜỚỞỠỢÙÚỦŨỤỪỨỬỮỰỲÝỶỸỴ]/;
const HUNGARIAN_REGEX = /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/;
const LATIN_NAME_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿĀ-žḀ-ỿ\s'.-]+$/u;

const containsHangul = (value: string) => HANGUL_REGEX.test(value);
const containsCJK = (value: string) => CJK_REGEX.test(value);
const containsHiragana = (value: string) => HIRAGANA_REGEX.test(value);
const containsKatakana = (value: string) => KATAKANA_REGEX.test(value);
const containsMongolian = (value: string) => MONGOLIAN_REGEX.test(value);
const containsVietnameseMarks = (value: string) => VIETNAMESE_REGEX.test(value);
const containsHungarianMarks = (value: string) => HUNGARIAN_REGEX.test(value);
const isLatinName = (value: string) => LATIN_NAME_REGEX.test(value);

const normalizeSpaces = (value: string) => value.replace(/\s+/g, ' ').trim();

const capitalizeLatinWord = (value: string) => {
  if (!value) return '';
  const firstChar = value.charAt(0).toLocaleUpperCase();
  const remainder = value.slice(1).toLocaleLowerCase();
  return `${firstChar}${remainder}`;
};

export const formatNameForDisplay = (rawValue: string) => {
  if (!rawValue) return '';
  const normalized = normalizeSpaces(rawValue);
  if (!normalized) return '';

  if (!isLatinName(normalized)) {
    return normalized;
  }

  const words = normalized.split(' ').filter(Boolean);
  return words.map(capitalizeLatinWord).join(' ');
};

const detectNameOrder = (value: string): 'firstLast' | 'lastFirst' => {
  if (!value) return 'firstLast';
  if (
    containsHangul(value) ||
    containsCJK(value) ||
    containsHiragana(value) ||
    containsKatakana(value) ||
    containsMongolian(value) ||
    containsVietnameseMarks(value) ||
    containsHungarianMarks(value)
  ) {
    return 'lastFirst';
  }
  return 'firstLast';
};

export const parseCustomerName = (rawValue: string): ParsedName => {
  const normalized = normalizeSpaces(rawValue);
  if (!normalized) {
    return { firstName: '', lastName: '', displayName: '', order: 'firstLast' };
  }

  const order = detectNameOrder(normalized);
  const parts = normalized.split(' ');

  if (parts.length === 1) {
    if (order === 'firstLast') {
      return { firstName: parts[0], lastName: '', displayName: normalized, order };
    }
    return { firstName: '', lastName: parts[0], displayName: normalized, order };
  }

  if (order === 'firstLast') {
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ');
    return { firstName, lastName, displayName: normalized, order };
  }

  const lastName = parts[0];
  const firstName = parts.slice(1).join(' ');
  return { firstName, lastName, displayName: normalized, order };
};

