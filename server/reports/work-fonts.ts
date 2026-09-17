import "server-only";

import { existsSync } from "node:fs";
import path from "node:path";
import { Font } from "@react-pdf/renderer";
import { logServerError } from "@/lib/errors";

const FONTS_DIR = path.join(process.cwd(), "server", "reports", "fonts");

const GEIST_FILES: { file: string; fontWeight: 400 | 500 | 600 | 700 }[] = [
  { file: "Geist-Regular.ttf", fontWeight: 400 },
  { file: "Geist-Medium.ttf", fontWeight: 500 },
  { file: "Geist-SemiBold.ttf", fontWeight: 600 },
  { file: "Geist-Bold.ttf", fontWeight: 700 },
];

let registered: "Geist" | "Helvetica" | null = null;

/**
 * Registra a Geist (mesma fonte da interface) para os relatórios de Obras.
 * Idempotente; se os arquivos não estiverem no ambiente, cai para Helvetica
 * sem quebrar a geração do PDF.
 */
export function ensureWorkReportFont(): "Geist" | "Helvetica" {
  if (registered) return registered;

  const fonts = GEIST_FILES.map(({ file, fontWeight }) => ({
    src: path.join(FONTS_DIR, file),
    fontWeight,
  }));

  if (!fonts.every((font) => existsSync(font.src))) {
    registered = "Helvetica";
    return registered;
  }

  try {
    Font.register({ family: "Geist", fonts });
    registered = "Geist";
  } catch (error) {
    logServerError("reports.workFonts", error);
    registered = "Helvetica";
  }

  return registered;
}
