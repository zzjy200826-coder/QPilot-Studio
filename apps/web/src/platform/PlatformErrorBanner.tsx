export const PlatformErrorBanner = ({
  messages
}: {
  messages: string[];
}) => {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="console-alert rounded-[20px] border border-rose-200/80 bg-rose-50/92 px-4 py-3 text-sm text-rose-800">
      <div className="space-y-1">
        {messages.map((message) => (
          <p key={message}>{message}</p>
        ))}
      </div>
    </div>
  );
};
