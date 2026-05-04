function determineProcessingMode(text, userMode = 'auto') {
  if (userMode !== 'auto') {
    return userMode;
  }

  const trimmed = text.trim();
  const textLength = trimmed.length;
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;

  if (textLength > 150 || wordCount > 30) {
    return 'optimize_long';
  }

  return 'optimize';
}

describe('determineProcessingMode', () => {
  it('returns explicit mode without auto detection', () => {
    expect(determineProcessingMode('任意文本', 'optimize_long')).toBe('optimize_long');
  });

  it('uses optimize for short text', () => {
    expect(determineProcessingMode('今天天气不错，我想出去走走。')).toBe('optimize');
  });

  it('uses optimize_long when text length exceeds threshold', () => {
    const longText = '今天天气不错。'.repeat(40);
    expect(determineProcessingMode(longText)).toBe('optimize_long');
  });

  it('uses optimize_long when word count exceeds threshold', () => {
    const manyWords = new Array(31).fill('word').join(' ');
    expect(determineProcessingMode(manyWords)).toBe('optimize_long');
  });
});