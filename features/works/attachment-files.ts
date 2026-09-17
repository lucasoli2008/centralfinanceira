/** Regras de arquivo do cliente — espelham as do servidor em `actions.ts` (uploadWorkAttachment). */

export const ATTACHMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp";
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const ALLOWED_EXT = /\.(pdf|jpe?g|png|webp)$/i;

export function validateAttachmentFile(file: File): string | null {
  const typeOk = file.type ? ALLOWED_MIME.has(file.type) : ALLOWED_EXT.test(file.name);
  if (!typeOk) return "formato não suportado (use PDF, JPG, PNG ou WEBP).";
  if (file.size === 0) return "arquivo vazio.";
  if (file.size > ATTACHMENT_MAX_BYTES) return "arquivo muito grande (máx. 10 MB).";
  return null;
}

export function describeFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export function isPhotoCategory(category: string): boolean {
  return category.startsWith("foto_");
}
