export type ImageDataUrlOptions = {
  maxBytes: number;
};

function domainError(status: number, code: string) {
  const err = new Error(code) as Error & { status: number };
  err.status = status;
  return err;
}

export async function fileToImageDataUrl(file: File, opt: ImageDataUrlOptions) {
  if (!file || typeof file.type !== "string" || !file.type.startsWith("image/")) throw domainError(400, "INVALID_IMAGE");
  const maxBytes = Math.max(1, Math.floor(Number(opt.maxBytes)));
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > maxBytes) throw domainError(413, "IMAGE_TOO_LARGE");
  const buf = Buffer.from(await file.arrayBuffer());
  const base64 = buf.toString("base64");
  return `data:${file.type};base64,${base64}`;
}

export function readImageFileFromFormData(formData: FormData, key: string) {
  const v = formData.get(key);
  if (!v) return null;
  if (typeof v === "string") return null;
  if (typeof (v as unknown as { arrayBuffer?: unknown }).arrayBuffer !== "function") return null;
  return v as unknown as File;
}

