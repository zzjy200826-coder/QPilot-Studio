const normalizeHost = (value?: string | null): string =>
  value?.trim().toLowerCase() ?? "";

export const marketingHost = normalizeHost(import.meta.env.VITE_PUBLIC_MARKETING_HOST);
export const privateAppOrigin = import.meta.env.VITE_PRIVATE_APP_ORIGIN?.trim() ?? "";

export const isMarketingHost = (host: string): boolean => {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) {
    return false;
  }
  if (marketingHost) {
    return normalizedHost === marketingHost;
  }
  if (normalizedHost === "localhost" || normalizedHost.startsWith("127.0.0.1")) {
    return false;
  }
  return normalizedHost.startsWith("www.");
};

export const resolvePrivateAppLoginUrl = (input: {
  host: string;
  protocol: string;
}): string => {
  const normalizedHost = normalizeHost(input.host);
  if (privateAppOrigin) {
    return `${privateAppOrigin.replace(/\/+$/, "")}/login`;
  }
  if (normalizedHost.startsWith("www.")) {
    return `${input.protocol}//app.${normalizedHost.slice(4)}/login`;
  }
  return "/login";
};
