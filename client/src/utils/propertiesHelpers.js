export const VIOLATED_PROPERTY_LINK = 'https://confluence.artsofte.ru/x/Bru6CQ';

export const stripPropertyLinks = (text) =>
{
  const re = /\[[^\]]+\|https:\/\/confluence\.artsofte\.ru\/x\/Bru6CQ\]\s*/g;
  return (text || '').replace(re, '').trim();
};

export const formatPropertiesForJira = (properties) =>
{
  const text = (properties || '').trim();
  if (!text) return '';
  if (text.includes(VIOLATED_PROPERTY_LINK)) return text;
  return `[${text}|${VIOLATED_PROPERTY_LINK}]`;
};
