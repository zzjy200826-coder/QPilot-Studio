import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        panel: "#f8fafc",
        accent: "#0ea5e9"
      }
    }
  },
  plugins: []
} satisfies Config;
