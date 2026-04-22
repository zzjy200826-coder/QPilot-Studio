const suspiciousFragments = [
  "\uFFFD",
  "\u95f8",
  "\u95f9",
  "\u95fa",
  "\u9420",
  "\u95c2",
  "\u95bb",
  "\u93c9",
  "\u6fe9\u7a3f",
  "\u5a23",
  "\u9352",
  "\u9359",
  "\u9354",
  "\u9369",
  "\u951b",
  "\u7f01",
  "\u7f02",
  "\u93ba",
  "\u93bb",
  "\u93cc",
  "\u93cd",
  "\u93c2",
  "\u93c3",
  "\u93c7",
  "\u95ab",
  "\u93c6",
  "\u6d93",
  "\u7b17",
  "\u741b",
  "\u95c3",
  "\u95c0",
  "\u68f0",
  "\u59ab"
];

const suspiciousCharPattern =
  /[\u95f8\u95f9\u95fa\u9420\u95c2\u95bb\u93c9\u5a23\u9352\u9359\u9354\u9369\u951b\u7f01\u7f02\u93ba\u93bb\u93cc\u93cd\u93c2\u93c3\u93c7\u95ab\u6d93\u7b17\u741b\u95c3\u95c0\u68f0\u59ab]/g;

export const isProbablyCorruptedTranslation = (value: string): boolean => {
  if (!value) {
    return false;
  }

  if (value.includes("\uFFFD")) {
    return true;
  }

  const fragmentHits = suspiciousFragments.reduce(
    (count, fragment) => count + (value.includes(fragment) ? 1 : 0),
    0
  );
  if (fragmentHits >= 2) {
    return true;
  }

  const suspiciousCharCount = value.match(suspiciousCharPattern)?.length ?? 0;
  return suspiciousCharCount >= 3;
};
