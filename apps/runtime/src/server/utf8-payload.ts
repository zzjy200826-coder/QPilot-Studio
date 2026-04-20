const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const normalizeBase64 = (value: string): string => value.replace(/\s+/g, "");

export const looksEncodingDamaged = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  return trimmed.includes("\uFFFD") || /^\?{2,}$/.test(trimmed);
};

export const decodeUtf8Base64Text = (value: string, fieldName: string): string => {
  const normalized = normalizeBase64(value);
  if (!normalized || !BASE64_PATTERN.test(normalized)) {
    throw new Error(`${fieldName}Base64 must be valid base64-encoded UTF-8 text.`);
  }

  const decoded = Buffer.from(normalized, "base64").toString("utf8");
  if (decoded.includes("\uFFFD")) {
    throw new Error(`${fieldName}Base64 could not be decoded as UTF-8 text.`);
  }

  return decoded;
};

export const resolveUtf8TextInput = (input: {
  fieldName: string;
  value?: string;
  valueBase64?: string;
}): string | undefined => {
  const encoded = input.valueBase64?.trim();
  if (encoded) {
    return decodeUtf8Base64Text(encoded, input.fieldName);
  }

  if (input.value === undefined) {
    return undefined;
  }

  if (looksEncodingDamaged(input.value)) {
    throw new Error(
      `${input.fieldName} appears to be encoding-damaged. Send UTF-8 text or use ${input.fieldName}Base64.`
    );
  }

  return input.value;
};
