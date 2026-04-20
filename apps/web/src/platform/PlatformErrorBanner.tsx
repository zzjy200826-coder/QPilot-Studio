export const PlatformErrorBanner = ({
  messages
}: {
  messages: string[];
}) => {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      <div className="space-y-1">
        {messages.map((message) => (
          <p key={message}>{message}</p>
        ))}
      </div>
    </div>
  );
};
