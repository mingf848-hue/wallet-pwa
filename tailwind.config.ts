import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: {
          bg: "#090f21",
          panel: "#121a2f",
          border: "#1c2741",
          soft: "#9098ae",
          cyan: "#13d6ff",
          green: "#23d169",
          red: "#ff5a5f",
          purple: "#7f5cff",
        },
      },
      boxShadow: {
        fab: "0 0 24px rgba(20, 215, 255, 0.45)",
      },
      fontFamily: {
        sans: [
          "SF Pro Display",
          "SF Pro Text",
          "PingFang SC",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
