import type { Attachment } from '../types'

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export async function filesToAttachments(files: File[]): Promise<Attachment[]> {
  return Promise.all(
    files.map(async file => {
      const attachment: Attachment = {
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type,
        size: file.size,
      }
      if (file.type.startsWith('image/')) {
        try {
          attachment.dataUrl = await readAsDataUrl(file)
        } catch {
          // preview unavailable, still attach without thumbnail
        }
      }
      return attachment
    })
  )
}
