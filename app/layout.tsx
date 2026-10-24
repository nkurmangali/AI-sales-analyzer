import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Разбор звонков",
  description: "Фидбек по созвону с лидом: резюме, потребности, возражения, замечания и фоллоу-ап",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
