export function calculateSmsSegments(text: string): { segmentCount: number; encoding: string } {
  const gsm7Chars = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>? ¡ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  let isGsm7 = true;
  for (const char of text) {
    if (!gsm7Chars.includes(char)) {
      isGsm7 = false;
      break;
    }
  }

  const encoding = isGsm7 ? 'GSM-7' : 'UCS-2';
  const maxPerSegment = isGsm7 ? 160 : 70;
  const maxPerConcat = isGsm7 ? 153 : 67;

  if (text.length <= maxPerSegment) {
    return { segmentCount: 1, encoding };
  }

  const segmentCount = Math.ceil(text.length / maxPerConcat);
  return { segmentCount, encoding };
}
